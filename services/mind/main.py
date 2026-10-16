"""Entry point: the HTTP API and the nightly worker in one container (ADR-081)."""

import threading

import server
import worker


def start() -> None:
    threading.Thread(target=worker.loop, daemon=True, name="nightly").start()
    server.main()


if __name__ == "__main__":
    start()
