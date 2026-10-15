"""Bounded self-optimization for the fast path (ADR 007), with Optuna.

Searches the SlidingWindow thresholds (gap, stop, speed-jump, port radius) on simulated traffic with labeled
scenarios, scoring each setting by how many injected truths it catches minus how many false alarms it raises on
both scenario and clean traffic. The result is written as a **proposal** (data/tuning_proposal.json) that a human
approves; nothing here changes the running rules.

    python tune.py                      # 40 trials, 3 seeds
    python tune.py --trials 80 --seeds 5
"""

import argparse
import json
import time
from pathlib import Path

import optuna

import bus as busmod
import fast_path
import pipeline
import simulate_ais

PORTS = pipeline.ports()
DEFAULTS = {"gap_s": 3 * 3600, "stop_s": 2 * 3600, "jump_kn": 8.0, "radius_km": 40.0}
# Search ranges stay close to physically sensible values: tuning may refine the rules, not reinvent them.
SPACE = {"gap_s": (3600, 6 * 3600), "stop_s": (3600, 4 * 3600), "jump_kn": (4.0, 15.0), "radius_km": (15.0, 60.0)}
OUT = Path(__file__).with_name("data") / "tuning_proposal.json"


def _alerts(sim: dict, params: dict, batch: int = 200) -> list[dict]:
    window = fast_path.SlidingWindow(ports=PORTS, **params)
    rows = sorted(sim["positions"], key=lambda p: p["ts"])
    out = []
    for i in range(0, len(rows), batch):
        out += window.ingest(busmod.decode_batch(busmod.encode_batch(rows[i:i + batch])))
    return out


def score(params: dict, seeds: list[int], ships: int = 30) -> dict:
    """Recall on injected scenarios, and false alarms per run on scenario and clean traffic."""
    caught = total = false_alarms = 0
    for seed in seeds:
        sim = simulate_ais.simulate(ships=ships, hours=24, seed=seed, scenarios=True)
        truth = {t["scenario"]: t for t in sim["scenarios"]}
        alerts = _alerts(sim, params)
        dark = truth.get("dark_ship", {}).get("mmsi")
        port = truth.get("port_congestion", {}).get("port")
        hits = {"dark_ship": any(a["type"] in ("ais_gap", "ais_silent") and a.get("mmsi") == dark for a in alerts),
                "port_congestion": any(a["type"] == "port_congestion" and a.get("port") == port for a in alerts)}
        total += sum(1 for k in hits if k in truth)
        caught += sum(1 for k, v in hits.items() if v and k in truth)
        expected = {dark} if dark else set()
        false_alarms += sum(1 for a in alerts if a["type"] in ("ais_gap", "ais_silent", "speed_jump", "vessel_stopped")
                            and a.get("mmsi") not in expected)
        false_alarms += sum(1 for a in alerts if a["type"] == "port_congestion" and a.get("port") != port)
        clean = simulate_ais.simulate(ships=ships, hours=24, seed=seed + 1000, scenarios=False)
        false_alarms += len(_alerts(clean, params))
    runs = len(seeds) * 2
    recall = caught / total if total else 0.0
    return {"recall": round(recall, 3), "false_alarms_per_run": round(false_alarms / runs, 2),
            # Missing a real event costs far more than a false alarm, but noise still counts.
            "objective": round(recall - 0.05 * false_alarms / runs, 4)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args()
    seeds = list(range(100, 100 + a.seeds))
    t0 = time.time()

    baseline = score(DEFAULTS, seeds)

    def objective(trial: optuna.Trial) -> float:
        p = {"gap_s": trial.suggest_int("gap_s", *SPACE["gap_s"], step=900),
             "stop_s": trial.suggest_int("stop_s", *SPACE["stop_s"], step=900),
             "jump_kn": trial.suggest_float("jump_kn", *SPACE["jump_kn"], step=0.5),
             "radius_km": trial.suggest_float("radius_km", *SPACE["radius_km"], step=5.0)}
        s = score(p, seeds)
        trial.set_user_attr("score", s)
        return s["objective"]

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=7))
    study.enqueue_trial(DEFAULTS)                         # the current rules are always one of the candidates
    study.optimize(objective, n_trials=a.trials)

    best = study.best_trial
    proposal = {
        "status": "proposed",                             # a human flips this to approved before it is used
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": f"Optuna TPE, {a.trials} trials, seeds {seeds}, simulated traffic with labeled scenarios",
        "current": {"params": DEFAULTS, "score": baseline},
        "proposed": {"params": best.params, "score": best.user_attrs["score"]},
        "improves": best.value > baseline["objective"],
        "seconds": round(time.time() - t0, 1),
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(proposal, indent=2))
    print(json.dumps(proposal, indent=2))


if __name__ == "__main__":
    main()
