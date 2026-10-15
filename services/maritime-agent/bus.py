"""Speed-layer event bus: Redis Streams with consumer groups, and an in-process twin with the same API.

Producers XADD record batches; consumers read through a consumer group, process, then XACK, so a crashed
consumer's unacknowledged messages stay pending for another worker. Batches travel as **Apache Arrow IPC**
bytes: the consumer maps them back into a columnar Table without parsing JSON row by row.

    bus = await get_bus()                    # Redis if REDIS_URL answers, else the in-process bus
    await bus.ensure_group("omega:ais", "fastpath")
    await bus.xadd("omega:ais", {"arrow": encode_batch(rows), "n": len(rows), "t0": time.time_ns()})
    for msg_id, fields in await bus.read("omega:ais", "fastpath", "w1", count=10, block_ms=200):
        table = decode_batch(fields["arrow"]); ...; await bus.ack("omega:ais", "fastpath", msg_id)
"""

from __future__ import annotations

import asyncio
import os
from collections import defaultdict

import pyarrow as pa

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
MAXLEN = int(os.environ.get("OMEGA_STREAM_MAXLEN", "2000"))      # ~200-row Arrow batches: ~20 MB cap in Redis

SCHEMA = pa.schema([("mmsi", pa.int64()), ("ts", pa.string()), ("lon", pa.float64()), ("lat", pa.float64()),
                    ("sog", pa.float64()), ("cog", pa.float64())])


def encode_batch(rows: list[dict]) -> bytes:
    """Rows → Arrow IPC stream bytes (columnar, typed, no per-row JSON)."""
    table = pa.Table.from_pylist([{k: r.get(k) for k in SCHEMA.names} for r in rows], schema=SCHEMA)
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as w:
        w.write_table(table)
    return sink.getvalue().to_pybytes()


def decode_batch(data: bytes) -> pa.Table:
    """Arrow IPC bytes → Table, reading the buffers in place (zero-copy over the received bytes)."""
    return pa.ipc.open_stream(pa.py_buffer(data)).read_all()


def _b(v):
    return v.encode() if isinstance(v, str) else v


class InMemoryBus:
    """Redis-Streams semantics in one process: ordered ids, consumer groups, pending entries, blocking reads."""

    kind = "memory"

    def __init__(self):
        self.streams: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        self.groups: dict[tuple[str, str], dict] = {}
        self.seq = 0
        self.cond = asyncio.Condition()

    async def ensure_group(self, stream: str, group: str) -> None:
        self.groups.setdefault((stream, group), {"next": 0, "pending": {}})

    async def xadd(self, stream: str, fields: dict) -> str:
        async with self.cond:
            self.seq += 1
            msg_id = f"{self.seq}-0"
            self.streams[stream].append((msg_id, {k: _b(v) if not isinstance(v, bytes) else v for k, v in fields.items()}))
            if len(self.streams[stream]) > MAXLEN:
                drop = len(self.streams[stream]) - MAXLEN
                self.streams[stream] = self.streams[stream][drop:]
                for (s, _), g in self.groups.items():
                    if s == stream:
                        g["next"] = max(0, g["next"] - drop)
            self.cond.notify_all()
            return msg_id

    async def read(self, stream: str, group: str, consumer: str, count: int = 10, block_ms: int = 100) -> list[tuple[str, dict]]:
        g = self.groups[(stream, group)]
        async with self.cond:
            if g["next"] >= len(self.streams[stream]) and block_ms:
                try:
                    await asyncio.wait_for(self.cond.wait_for(lambda: g["next"] < len(self.streams[stream])), block_ms / 1000)
                except TimeoutError:
                    return []
            batch = self.streams[stream][g["next"]: g["next"] + count]
            g["next"] += len(batch)
            for msg_id, _ in batch:
                g["pending"][msg_id] = consumer
            return batch

    async def ack(self, stream: str, group: str, *ids: str) -> int:
        pending = self.groups[(stream, group)]["pending"]
        return sum(1 for i in ids if pending.pop(i, None) is not None)

    async def pending(self, stream: str, group: str) -> int:
        return len(self.groups[(stream, group)]["pending"])

    async def length(self, stream: str) -> int:
        return len(self.streams[stream])

    async def close(self) -> None:
        return None


class RedisBus:
    """The same API over a real Redis (or fakeredis in tests) via redis.asyncio."""

    kind = "redis"

    def __init__(self, client):
        self.r = client

    async def ensure_group(self, stream: str, group: str) -> None:
        try:
            await self.r.xgroup_create(stream, group, id="0", mkstream=True)
        except Exception as e:                       # BUSYGROUP: the group already exists
            if "BUSYGROUP" not in str(e):
                raise

    async def xadd(self, stream: str, fields: dict) -> str:
        msg_id = await self.r.xadd(stream, fields, maxlen=MAXLEN, approximate=True)
        return msg_id.decode() if isinstance(msg_id, bytes) else msg_id

    async def read(self, stream: str, group: str, consumer: str, count: int = 10, block_ms: int = 100) -> list[tuple[str, dict]]:
        res = await self.r.xreadgroup(group, consumer, {stream: ">"}, count=count, block=block_ms or None)
        out = []
        for _, entries in res or []:
            for msg_id, fields in entries:
                out.append((msg_id.decode() if isinstance(msg_id, bytes) else msg_id,
                            {(k.decode() if isinstance(k, bytes) else k): v for k, v in fields.items()}))
        return out

    async def ack(self, stream: str, group: str, *ids: str) -> int:
        return await self.r.xack(stream, group, *ids) if ids else 0

    async def pending(self, stream: str, group: str) -> int:
        info = await self.r.xpending(stream, group)
        return int(info["pending"] if isinstance(info, dict) else info[0])

    async def length(self, stream: str) -> int:
        return await self.r.xlen(stream)

    async def close(self) -> None:
        await self.r.aclose()


async def get_bus(url: str | None = None):
    """Redis when it answers within a second, otherwise the in-process bus (local-first)."""
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(url or REDIS_URL, socket_connect_timeout=1)
        await asyncio.wait_for(client.ping(), 1.5)
        return RedisBus(client)
    except Exception:
        return InMemoryBus()
