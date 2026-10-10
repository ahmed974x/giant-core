-- Director 00 long-term memory (pgvector) and the human approval ledger.
-- Runs once on first start of the `memory` container (docker compose --profile director up -d).

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per remembered fact, decision or outcome. The embedding dimension must match DIRECTOR_EMBED_DIM
-- (384 by default: the built-in hashing embedder and small open models such as bge-small / all-MiniLM).
CREATE TABLE IF NOT EXISTS agent_memories (
    id          BIGSERIAL PRIMARY KEY,
    agent       TEXT        NOT NULL DEFAULT 'director-00',
    kind        TEXT        NOT NULL CHECK (kind IN ('fact', 'decision', 'outcome', 'preference', 'note')),
    content     TEXT        NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    embedding   vector(384) NOT NULL,
    approved_by TEXT        NOT NULL,                    -- every write is human-approved (ADR 007)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW cosine index: fast nearest-neighbour recall with a small memory footprint.
CREATE INDEX IF NOT EXISTS agent_memories_embedding_hnsw
    ON agent_memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS agent_memories_agent_kind ON agent_memories (agent, kind, created_at DESC);

-- Every proposal Director 00 makes, and what the human decided. Nothing executes without a row here
-- moving from 'pending' to 'approved'.
CREATE TABLE IF NOT EXISTS director_approvals (
    thread_id   TEXT        PRIMARY KEY,
    request     TEXT        NOT NULL,
    proposal    JSONB       NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
    decided_by  TEXT,
    decided_at  TIMESTAMPTZ,
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS director_approvals_status ON director_approvals (status, created_at DESC);
