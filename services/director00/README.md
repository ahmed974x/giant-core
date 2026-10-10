# Director 00: coordinator with memory and a human gate

A LangGraph state machine that recalls long-term memories (pgvector RAG), plans, and then **stops for Ahmad's
approval before any state change or external action**.

```
START → retrieve (RAG) → plan ─┬─(no actions)──────────────────────────→ END
                               └→ approval ⏸ (interrupt, checkpointed) ─┬─ approved → execute → END
                                                                        └─ rejected ────────────→ END
```

| Node | Does | Side effects |
| --- | --- | --- |
| `retrieve` | Embeds the request, recalls the 5 closest `agent_memories` (cosine) | none |
| `plan` | Drafts an answer and *proposed* actions (LLM if `DIRECTOR_LLM_URL` is set, else rules) | none |
| `approval` | Records the proposal in `director_approvals`, then pauses with `interrupt()` | ledger row only |
| `execute` | Runs only the approved actions (`remember` → memory write, `notify` → local webhook) | yes, after approval |

The pause survives restarts: LangGraph checkpoints each thread to `data/checkpoints.sqlite`, so a proposal made
now can be approved later from another process (or from the phone through Claude).

## Run

```bash
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt

python cli.py ask "remember: Hormuz traffic is the main driver of Brent for us"   # → awaiting_approval + thread_id
python cli.py pending
python cli.py approve <thread_id> --by Ahmad          # or: reject <thread_id> --reason "..."; --only 0 2 for some actions
python cli.py ask "What drives Brent for us?"          # answered from memory, nothing to approve
python cli.py recall "Hormuz"
```

**Storage.** With `DIRECTOR_DB_URL` set it uses Postgres + pgvector (`docker compose --profile director up -d`,
schema in `db/director/01-memory.sql`, 256 MB cap, port 5435 on localhost only). Without it, the same interface runs
on a local SQLite file, which is how it works on this laptop until Docker is available.

**Embeddings.** Default is a built-in 384-d hashing embedder (no model, no RAM). Point `DIRECTOR_EMBED_URL` /
`DIRECTOR_EMBED_MODEL` at an OpenAI-compatible endpoint (e.g. Ollama `all-minilm`, 384-d) for semantic recall.

**Planner.** Set `DIRECTOR_LLM_URL` / `DIRECTOR_LLM_MODEL` to any OpenAI-compatible chat endpoint. Whatever it returns
is filtered to the two known action types and still has to pass the approval gate.

**Notifications** only go to a local `DIRECTOR_NOTIFY_URL` (an n8n webhook or the relay), which then reaches the
outside world; anything else is skipped.

## Tests

```bash
python -m pytest -q                                   # offline: SQLite store
cd devtools && npm install && node pg-test-server.mjs # real Postgres + pgvector in WebAssembly (PGlite), no Docker
DIRECTOR_TEST_PG_URL="postgresql://postgres:x@127.0.0.1:5499/postgres?sslmode=disable" python -m pytest -q
```

Both runs pass (16 tests): nothing is written before approval, rejection runs nothing, partial approval runs only the
chosen actions, a decision cannot be replayed, LLM output is sanitised, and Arabic requests work.

## Why these packages

- **LangGraph** (MIT): `interrupt()` + checkpointer is exactly a durable human-in-the-loop pause.
- **pg8000** (BSD): pure-Python Postgres driver, so no native DLL meets this laptop's Application Control policy.
- **NumPy** only for the offline cosine search; no LangChain model integrations are pulled in.
- No HashiCorp Vault: the DB password lives in the git-ignored `.env`; OpenBao is the path if a secrets server is needed.
