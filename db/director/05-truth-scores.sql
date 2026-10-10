-- Truth Layer (ADR-021): a credibility score for every GDELT news item. Items below 0.7 are 'unverified' and are not
-- used by Director 00 or the Butterfly Engine as evidence for decisions.

CREATE TABLE IF NOT EXISTS truth_scores (
    event_id     TEXT        PRIMARY KEY,                 -- GKG record id or GDELT event id
    score        REAL        NOT NULL CHECK (score BETWEEN 0 AND 1),
    status       TEXT        NOT NULL CHECK (status IN ('verified', 'unverified')),
    flags        TEXT[]      NOT NULL DEFAULT '{}',
    source_tier  TEXT        NOT NULL DEFAULT 'unknown',
    sources      INTEGER     NOT NULL DEFAULT 1,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS truth_scores_status ON truth_scores (status, computed_at DESC);
CREATE INDEX IF NOT EXISTS truth_scores_flags_gin ON truth_scores USING gin (flags);
