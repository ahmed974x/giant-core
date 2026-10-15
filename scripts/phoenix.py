"""Phoenix Protocol entry point (ADR-020): run one self-healing pass, show status, or loop.

    services/director00/.venv/Scripts/python.exe scripts/phoenix.py            # one pass (what the scheduled task runs)
    services/director00/.venv/Scripts/python.exe scripts/phoenix.py status
    services/director00/.venv/Scripts/python.exe scripts/phoenix.py loop 300   # foreground alternative to the task
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "director00"))

import phoenix  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(phoenix.main(sys.argv[1:]))
