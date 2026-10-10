-- Phase 4 Phoenix actions (ADR-037, ADR-038): the morning briefing and the restore drill log as 'morning' and
-- 'restore-drill'. Plain statements (no DO block) because PgStore.ensure_schema splits files on semicolons;
-- dropping and re-adding the constraint is idempotent.
ALTER TABLE phoenix_events DROP CONSTRAINT IF EXISTS phoenix_events_action_check;
ALTER TABLE phoenix_events ADD CONSTRAINT phoenix_events_action_check
    CHECK (action IN ('heartbeat', 'detect', 'restart', 'restore', 'backup', 'notify', 'recover', 'restore-drill', 'morning'));
