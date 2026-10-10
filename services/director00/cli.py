"""Director 00 command line.

    python cli.py ask "remember: Hormuz traffic matters most for Brent"
    python cli.py pending
    python cli.py approve <thread_id> [--by Ahmad] [--only 0 2]
    python cli.py confirm <thread_id> "CONFIRM AB12" [--by Ahmad]          # second step for HIGH-risk proposals
    python cli.py reject  <thread_id> --code RISK-001 [--reason "..."]     # codes: RISK-001 COMPLIANCE-002 ESCALATION-004 USER-005
    python cli.py expire                                                   # EXPIRED-003 for anything past the approval window
    python cli.py rejections [thread_id]
    python cli.py recall  "Hormuz"
    python cli.py backup
"""

import argparse
import json
import sys

from director import Director
from risk import REJECTION_CODES


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Director 00: memory-backed coordinator with a two-level human approval gate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ask"); a.add_argument("request")
    sub.add_parser("pending")
    p = sub.add_parser("approve"); p.add_argument("thread_id"); p.add_argument("--by", default="human")
    p.add_argument("--only", type=int, nargs="*", help="approve only these action indexes")
    c = sub.add_parser("confirm"); c.add_argument("thread_id"); c.add_argument("phrase"); c.add_argument("--by", default="human")
    r = sub.add_parser("reject"); r.add_argument("thread_id"); r.add_argument("--by", default="human")
    r.add_argument("--code", default="USER-005", choices=[k for k in REJECTION_CODES if k != "EXPIRED-003"]); r.add_argument("--reason", default="")
    sub.add_parser("expire")
    j = sub.add_parser("rejections"); j.add_argument("thread_id", nargs="?")
    q = sub.add_parser("recall"); q.add_argument("query"); q.add_argument("-k", type=int, default=5)
    sub.add_parser("backup")
    args = ap.parse_args(argv)

    d = Director()
    if args.cmd == "ask":
        out = d.ask(args.request)
    elif args.cmd == "pending":
        out = d.pending()
    elif args.cmd == "approve":
        out = d.decide(args.thread_id, True, by=args.by, only=args.only)
    elif args.cmd == "confirm":
        out = d.confirm(args.thread_id, args.phrase, by=args.by)
    elif args.cmd == "reject":
        row = d.store.approval(args.thread_id) or {}
        out = (d.confirm(args.thread_id, "", by=args.by, approved=False, reason=args.reason) if row.get("status") == "escalated"
               else d.decide(args.thread_id, False, by=args.by, reason=args.reason, code=args.code))
    elif args.cmd == "expire":
        out = {"expired": d.expire_stale()}
    elif args.cmd == "rejections":
        out = d.rejections(args.thread_id)
    elif args.cmd == "backup":
        out = d.backup()
    else:
        out = d.recall(args.query, args.k)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
