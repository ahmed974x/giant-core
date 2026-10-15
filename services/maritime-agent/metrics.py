"""Speed metrics for Prometheus: how fast each stage of the decision path is, in milliseconds.

    omega_ingest_latency_ms     producer XADD → consumer has the batch
    omega_fast_path_ms          rules over one batch (Polars + DuckDB)
    omega_inference_ms          ONNX slow-path scoring of one alert batch
    omega_decision_ms           batch produced → scored, localized decision out (end to end)
    omega_api_ms                Director 00 sub-agent calls (market context etc.)
    omega_alerts_total{path,type}
Exposed on :9108/metrics by pipeline.py (prometheus scrapes it; see ops/prometheus/prometheus.yml).
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram, start_http_server

REGISTRY = CollectorRegistry()
_MS = (0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000)

ingest_ms = Histogram("omega_ingest_latency_ms", "Stream produce → consume latency", buckets=_MS, registry=REGISTRY)
fast_ms = Histogram("omega_fast_path_ms", "Fast-path rules per batch", buckets=_MS, registry=REGISTRY)
inference_ms = Histogram("omega_inference_ms", "ONNX slow-path inference per batch", buckets=_MS, registry=REGISTRY)
decision_ms = Histogram("omega_decision_ms", "Event produced → decision out", buckets=_MS, registry=REGISTRY)
api_ms = Histogram("omega_api_ms", "Director 00 sub-agent call time", ["agent"], buckets=_MS, registry=REGISTRY)
alerts = Counter("omega_alerts_total", "Alerts emitted", ["path", "type"], registry=REGISTRY)


def serve(port: int = 9108) -> None:
    start_http_server(port, registry=REGISTRY)
