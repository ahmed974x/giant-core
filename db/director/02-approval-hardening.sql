-- Phase 2 hardening of the Director 00 approval gate: an 'escalated' stage for high-risk proposals and a log of
-- every rejection with a reason code (RISK-001, COMPLIANCE-002, EXPIRED-003, ESCALATION-004, USER-005).

ALTER TABLE director_approvals DROP CONSTRAINT IF EXISTS director_approvals_status_check;
ALTER TABLE director_approvals ADD CONSTRAINT director_approvals_status_check
    CHECK (status IN ('pending', 'escalated', 'approved', 'rejected', 'executed', 'failed'));
ALTER TABLE director_approvals ADD COLUMN IF NOT EXISTS risk JSONB NOT NULL DEFAULT '{"level": "low", "reasons": []}'::jsonb;
ALTER TABLE director_approvals ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

CREATE TABLE IF NOT EXISTS director_rejections (
    id          BIGSERIAL PRIMARY KEY,
    thread_id   TEXT        NOT NULL REFERENCES director_approvals (thread_id),
    code        TEXT        NOT NULL CHECK (code IN ('RISK-001', 'COMPLIANCE-002', 'EXPIRED-003', 'ESCALATION-004', 'USER-005')),
    stage       TEXT        NOT NULL CHECK (stage IN ('first', 'confirm', 'timeout')),
    reason      TEXT        NOT NULL DEFAULT '',
    rejected_by TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS director_rejections_code ON director_rejections (code, created_at DESC);
