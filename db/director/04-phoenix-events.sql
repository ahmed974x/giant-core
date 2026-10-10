-- Phoenix Protocol (ADR-020): every watchdog observation and action. One row per state change or action
-- (detect, restart, restore, backup, notify) plus one heartbeat per run, so the table stays small (~300 rows/day).

CREATE TABLE IF NOT EXISTS phoenix_events (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    service    TEXT        NOT NULL,
    action     TEXT        NOT NULL CHECK (action IN ('heartbeat', 'detect', 'restart', 'restore', 'backup', 'notify', 'recover')),
    result     TEXT        NOT NULL CHECK (result IN ('ok', 'down', 'failed', 'skipped')),
    detail     TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS phoenix_events_service_ts ON phoenix_events (service, ts DESC);
