"""Slow path: an ONNX-Runtime risk scorer for fast-path alerts (GPU when present, CPU otherwise).

The model is a small logistic regression over alert features, trained with NumPy on labeled simulated
traffic and written out as a standard ONNX graph (MatMul → Add → Sigmoid). The ONNX file is encoded here
directly as protobuf, so no extra builder package is needed (the `onnx` package's native extension is
blocked by this machine's application-control policy; onnxruntime itself runs fine).

Providers are tried in order CUDA → DirectML → CPU, keeping whichever this machine actually has.
Retraining on real labels later replaces the weights; the graph and the wrapper stay the same (ADR 007).
"""

from __future__ import annotations

import struct
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

FEATURES = ["gap_h", "jump_km_100", "stopped_h", "speed_jump", "is_congestion", "severity_high"]
PREFERRED = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]


# ── minimal protobuf writer for the ONNX ModelProto ──
def _varint(n: int) -> bytes:
    out = bytearray()
    n &= (1 << 64) - 1
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _key(field: int, wire: int) -> bytes:
    return _varint(field << 3 | wire)


def _int(field: int, v: int) -> bytes:
    return _key(field, 0) + _varint(v)


def _bytes(field: int, v: bytes) -> bytes:
    return _key(field, 2) + _varint(len(v)) + v


def _str(field: int, s: str) -> bytes:
    return _bytes(field, s.encode())


def _tensor(name: str, dims: list[int], values: np.ndarray) -> bytes:   # TensorProto, FLOAT
    body = b"".join(_int(1, d) for d in dims) + _int(2, 1)
    body += _bytes(4, struct.pack(f"<{values.size}f", *values.astype(np.float32).ravel()))
    return body + _str(8, name)


def _value_info(name: str, dims: list) -> bytes:     # dims: int or str (symbolic)
    shape = b"".join(_bytes(1, _int(1, d) if isinstance(d, int) else _str(2, d)) for d in dims)
    tensor_type = _int(1, 1) + _bytes(2, shape)
    return _str(1, name) + _bytes(2, _bytes(1, tensor_type))


def _node(op: str, inputs: list[str], outputs: list[str], name: str) -> bytes:
    return b"".join(_str(1, i) for i in inputs) + b"".join(_str(2, o) for o in outputs) + _str(3, name) + _str(4, op)


def build_onnx(w: np.ndarray, b: float) -> bytes:
    """ModelProto bytes for p = sigmoid(X @ w + b), X: float[N, F]."""
    f = len(w)
    graph = (_bytes(1, _node("MatMul", ["X", "W"], ["Z"], "matmul"))
             + _bytes(1, _node("Add", ["Z", "B"], ["Y"], "add"))
             + _bytes(1, _node("Sigmoid", ["Y"], ["P"], "sigmoid"))
             + _str(2, "omega_risk")
             + _bytes(5, _tensor("W", [f, 1], np.asarray(w).reshape(f, 1)))
             + _bytes(5, _tensor("B", [1], np.asarray([b])))
             + _bytes(11, _value_info("X", ["N", f]))
             + _bytes(12, _value_info("P", ["N", 1])))
    opset = _str(1, "") + _int(2, 13)
    return _int(1, 8) + _str(2, "omega-prime") + _bytes(7, graph) + _bytes(8, opset)


# ── features + training on simulated labels ──
def features(alert: dict) -> list[float]:
    return [float(alert.get("gap_h", 0.0)), float(alert.get("jump_km", 0.0)) / 100.0,
            float(alert.get("stopped_h", 0.0)), 1.0 if alert.get("type") == "speed_jump" else 0.0,
            1.0 if alert.get("type") == "port_congestion" else 0.0, 1.0 if alert.get("severity") == "high" else 0.0]


def _training_set(seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Labeled examples: real disruptions (long gaps with big jumps, heavy congestion) vs. benign noise."""
    rng = np.random.default_rng(seed)
    pos = [[rng.uniform(4, 12), rng.uniform(0.8, 3), 0, 0, 0, 1] for _ in range(80)]
    pos += [[0, 0, 0, 0, 1, 1] for _ in range(40)]
    pos += [[0, 0, rng.uniform(6, 30), 0, 0, 0] for _ in range(20)]
    neg = [[rng.uniform(3, 5), rng.uniform(0, 0.05), 0, 0, 0, 0] for _ in range(80)]   # quiet but didn't move
    neg += [[0, 0, rng.uniform(2, 4), 0, 0, 0] for _ in range(60)]                     # short anchoring
    neg += [[0, 0, 0, 1, 0, 0] for _ in range(60)]                                     # single speed glitch
    neg += [[0, 0, 0, 0, 1, 0] for _ in range(20)]                                     # mild congestion
    x = np.array(pos + neg, dtype=np.float64)
    y = np.array([1] * len(pos) + [0] * len(neg), dtype=np.float64)
    return x, y


def train(epochs: int = 2000, lr: float = 0.3) -> tuple[np.ndarray, float]:
    x, y = _training_set()
    w, b = np.zeros(x.shape[1]), 0.0
    for _ in range(epochs):
        p = 1 / (1 + np.exp(-(x @ w + b)))
        g = p - y
        w -= lr * (x.T @ g / len(y) + 1e-3 * w)
        b -= lr * g.mean()
    return w, float(b)


class Scorer:
    def __init__(self, model_path: str | None = None):
        if model_path and Path(model_path).exists():
            data = Path(model_path).read_bytes()
        else:
            data = build_onnx(*train())
            if model_path:
                Path(model_path).parent.mkdir(parents=True, exist_ok=True)
                Path(model_path).write_bytes(data)
        available = ort.get_available_providers()
        self.providers = [p for p in PREFERRED if p in available] or ["CPUExecutionProvider"]
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1                      # small model: one thread is fastest and gentlest
        self.session = ort.InferenceSession(data, sess_options=opts, providers=self.providers)
        self.device = self.session.get_providers()[0]
        self.last_ms = 0.0

    def score(self, alerts: list[dict]) -> list[float]:
        if not alerts:
            return []
        x = np.asarray([features(a) for a in alerts], dtype=np.float32)
        t0 = time.perf_counter()
        (p,) = self.session.run(["P"], {"X": x})
        self.last_ms = (time.perf_counter() - t0) * 1000
        return [round(float(v), 4) for v in p.ravel()]
