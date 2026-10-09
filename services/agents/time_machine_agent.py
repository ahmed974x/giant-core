#!/usr/bin/env python3
"""Time Machine agent for OMEGA PRIME.

The agent subscribes to a Redis stream for simulation tasks, looks up relevant
historical GDELT events and market context, then triggers a scenario replay and
publishes the outcome back to a result stream.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List

import redis.asyncio as redis

try:
    import backtrader as bt
except ImportError:  # pragma: no cover
    bt = None


REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
COMMAND_STREAM = os.getenv("TIME_MACHINE_COMMAND_STREAM", "omega:simulation:commands")
RESULT_STREAM = os.getenv("TIME_MACHINE_RESULT_STREAM", "omega:simulation:results")


def _load_gdelt_ingestor_module():
    module_path = Path(__file__).resolve().parents[1] / "time-machine" / "gdelt_ingestor.py"
    spec = importlib.util.spec_from_file_location("gdelt_ingestor", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _redis_client():
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


def parse_command_text(command_text: str) -> Dict[str, str]:
    normalized = command_text.strip()
    if not normalized:
        raise ValueError("Command payload is empty.")

    if normalized.lower().startswith("simulate "):
        scenario = normalized[len("simulate ") :].strip()
        return {
            "type": "simulate",
            "scenario": scenario,
            "theme": scenario,
        }

    if "simulate" in normalized.lower():
        scenario = normalized.lower().replace("simulate", "", 1).strip()
        return {
            "type": "simulate",
            "scenario": scenario,
            "theme": scenario,
        }

    return {
        "type": "query",
        "scenario": normalized,
        "theme": normalized,
    }


def _simulate_with_backtrader(events: Iterable[Dict[str, Any]], scenario: str) -> Dict[str, Any]:
    if bt is None:
        return _fallback_simulation(events, scenario)

    class ScenarioStrategy(bt.Strategy):
        params = ("scenario",)

        def __init__(self):
            self.order = None
            self.price = self.data.close
            self.signal = 0

        def next(self):
            if len(self.data) < 5:
                return
            trend = self.data.close[0] - self.data.close[-5]
            if trend > 0:
                self.signal = 1
            elif trend < 0:
                self.signal = -1
            else:
                self.signal = 0

    cerebro = bt.Cerebro()
    cerebro.addstrategy(ScenarioStrategy, scenario=scenario)
    data = bt.feeds.PandasData(dataname=events)
    cerebro.adddata(data)
    cerebro.broker.set_cash(100000.0)
    cerebro.addsizer(bt.sizers.FixedSize, stake=10)
    cerebro.run()
    portvalue = cerebro.broker.getvalue()
    return {
        "engine": "Backtrader",
        "scenario": scenario,
        "portfolio_value": round(portvalue, 2),
        "status": "completed",
    }


def _fallback_simulation(events: Iterable[Dict[str, Any]], scenario: str) -> Dict[str, Any]:
    record_list = list(events)
    event_count = len(record_list)
    sentiment = 0.0
    volatility = 0.0
    for item in record_list:
        tone = float(item.get("avg_tone") or 0.0)
        sentiment += tone
        volatility += abs(float(item.get("goldstein_scale") or 0.0))

    if event_count:
        sentiment /= event_count
        volatility /= event_count

    return {
        "engine": "FallbackSimulation",
        "scenario": scenario,
        "status": "completed",
        "event_count": event_count,
        "sentiment": round(sentiment, 4),
        "volatility": round(volatility, 4),
        "decision": "Hold neutral position; historical signal is mixed.",
    }


async def query_historical_context(scenario: str) -> List[Dict[str, Any]]:
    ingestor = _load_gdelt_ingestor_module()
    start_date = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    return ingestor.query_events_by_theme(scenario, start_date, end_date, limit=25)


async def process_command(command_text: str) -> Dict[str, Any]:
    command = parse_command_text(command_text)
    theme = command.get("theme") or command.get("scenario")
    historical_data = await query_historical_context(theme)
    result = _simulate_with_backtrader(historical_data, theme)
    result.update(
        {
            "theme": theme,
            "queried_event_count": len(historical_data),
            "timestamp": datetime.utcnow().isoformat(timespec="seconds"),
        }
    )
    return result


async def listen_for_commands() -> None:
    client = await _redis_client()
    while True:
        try:
            entries = await client.xread({COMMAND_STREAM: "$"}, block=5000, count=10)
            for _, messages in entries:
                for message_id, payload in messages:
                    command_text = payload.get("command") or payload.get("message") or payload.get("scenario")
                    if not command_text:
                        continue
                    result = await process_command(command_text)
                    await client.xadd(
                        RESULT_STREAM,
                        {
                            "command": command_text,
                            "result": json.dumps(result),
                            "timestamp": datetime.utcnow().isoformat(timespec="seconds"),
                        },
                    )
                    print(f"Processed command {message_id}: {command_text}")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            print(f"Time Machine agent error: {exc}")
            await asyncio.sleep(2)


async def main() -> None:
    await listen_for_commands()


if __name__ == "__main__":
    asyncio.run(main())
