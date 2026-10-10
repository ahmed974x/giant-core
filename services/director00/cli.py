"""Director 00 command line.

    python cli.py ask "remember: Hormuz traffic matters most for Brent"
    python cli.py pending
    python cli.py approve <thread_id> [--by Ahmad] [--only 0 2]
    python cli.py reject  <thread_id> [--reason "not now"]
    python cli.py recall  "Hormuz"
"""

import argparse
import json
import sys

from director import Director


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Director 00: memory-backed coordinator with a human approval gate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ask"); a.add_argument("request")
    sub.add_parser("pending")
    p = sub.add_parser("approve"); p.add_argument("thread_id"); p.add_argument("--by", default="human")
    p.add_argument("--only", type=int, nargs="*", help="approve only these action indexes")
    r = sub.add_parser("reject"); r.add_argument("thread_id"); r.add_argument("--by", default="human"); r.add_argument("--reason", default="")
    q = sub.add_parser("recall"); q.add_argument("query"); q.add_argument("-k", type=int, default=5)
    args = ap.parse_args(argv)

    d = Director()
    if args.cmd == "ask":
        out = d.ask(args.request)
    elif args.cmd == "pending":
        out = d.pending()
    elif args.cmd == "approve":
        out = d.decide(args.thread_id, True, by=args.by, only=args.only)
    elif args.cmd == "reject":
        out = d.decide(args.thread_id, False, by=args.by, reason=args.reason)
    else:
        out = d.recall(args.query, args.k)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
