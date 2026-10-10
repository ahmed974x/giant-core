-- Entities extracted from the GDELT 2.0 Global Knowledge Graph: one row per news article, with the people,
-- organisations, places and themes it mentions and a sentiment tag from GDELT's tone score.
-- Privacy (ADR 006): a person is only stored when several articles in the same 15-minute batch name them
-- (public figures in the news), and rows older than DIRECTOR_ENTITY_RETENTION_DAYS (default 7) are purged.

-- array_to_string is only STABLE, so a generated column needs this IMMUTABLE wrapper (safe: plain text joining).
CREATE OR REPLACE FUNCTION omega_entity_text(p TEXT[], o TEXT[], l TEXT[], t TEXT[]) RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT array_to_string(p, ' ') || ' ' || array_to_string(o, ' ') || ' ' || array_to_string(l, ' ') || ' ' || array_to_string(t, ' ') $$;

CREATE TABLE IF NOT EXISTS event_entities (
    id            BIGSERIAL PRIMARY KEY,
    gkg_id        TEXT        NOT NULL UNIQUE,
    published_at  TIMESTAMPTZ NOT NULL,
    source_domain TEXT        NOT NULL DEFAULT '',
    url           TEXT        NOT NULL,
    persons       TEXT[]      NOT NULL DEFAULT '{}',
    orgs          TEXT[]      NOT NULL DEFAULT '{}',
    locations     TEXT[]      NOT NULL DEFAULT '{}',
    themes        TEXT[]      NOT NULL DEFAULT '{}',
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    tone          REAL        NOT NULL DEFAULT 0,
    sentiment     TEXT        NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    search        TSVECTOR GENERATED ALWAYS AS (
                      to_tsvector('simple'::regconfig, omega_entity_text(persons, orgs, locations, themes))) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GIN indexes: exact entity membership (persons @> ARRAY['…']) and free-text search over all entity names.
CREATE INDEX IF NOT EXISTS event_entities_persons_gin   ON event_entities USING gin (persons);
CREATE INDEX IF NOT EXISTS event_entities_orgs_gin      ON event_entities USING gin (orgs);
CREATE INDEX IF NOT EXISTS event_entities_locations_gin ON event_entities USING gin (locations);
CREATE INDEX IF NOT EXISTS event_entities_themes_gin    ON event_entities USING gin (themes);
CREATE INDEX IF NOT EXISTS event_entities_search_gin    ON event_entities USING gin (search);
CREATE INDEX IF NOT EXISTS event_entities_time          ON event_entities (published_at DESC);
