-- OMEGA PRIME geospatial store (PostGIS). Bilingual (Arabic/English) from day one.
-- Runs once, when PostGIS creates an empty data volume. Phase 1 of docs/ARCHITECTURE.md.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid()

-- Note: full-text search below uses the 'simple' config, which indexes both Arabic and Latin
-- scripts without stemming — the robust choice for proper nouns across languages.

-- ── Logistics nodes: ports, straits and choke-points, each named in both languages ──
CREATE TABLE logistics_nodes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text UNIQUE NOT NULL,                 -- stable machine id, e.g. 'hormuz'
    node_type       text NOT NULL CHECK (node_type IN ('port', 'chokepoint', 'canal', 'strait', 'terminal')),
    name_i18n       jsonb NOT NULL,                       -- {"en": "Strait of Hormuz", "ar": "مضيق هرمز"}
    description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
    coordinates     geometry(Point, 4326) NOT NULL,       -- WGS-84 lon/lat
    status          text NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'congested', 'disrupted', 'closed')),
    meta            jsonb NOT NULL DEFAULT '{}'::jsonb,    -- free attributes (daily transit, oil share, …)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Translations are validated: both languages must be present and non-empty.
ALTER TABLE logistics_nodes
  ADD CONSTRAINT name_has_both_languages
  CHECK (coalesce(name_i18n->>'en', '') <> '' AND coalesce(name_i18n->>'ar', '') <> '');

-- GIN over the JSONB names for key/containment lookups.
CREATE INDEX idx_nodes_name_i18n ON logistics_nodes USING GIN (name_i18n);
-- GiST spatial index for map/bbox/distance queries.
CREATE INDEX idx_nodes_geom ON logistics_nodes USING GIST (coordinates);
-- Bilingual full-text search: 'simple' handles both scripts without stemming surprises.
CREATE INDEX idx_nodes_fts ON logistics_nodes USING GIN (
  to_tsvector('simple', coalesce(name_i18n->>'en', '') || ' ' || coalesce(name_i18n->>'ar', '') || ' ' ||
                        coalesce(description_i18n->>'en', '') || ' ' || coalesce(description_i18n->>'ar', ''))
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_nodes_touch BEFORE UPDATE ON logistics_nodes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Seed: the world's major shipping choke-points (public geographic facts), bilingual ──
INSERT INTO logistics_nodes (slug, node_type, name_i18n, description_i18n, coordinates, meta) VALUES
('hormuz', 'strait',
  '{"en": "Strait of Hormuz", "ar": "مضيق هرمز"}',
  '{"en": "Main sea route for Gulf oil exports.", "ar": "الممر البحري الرئيسي لصادرات نفط الخليج."}',
  ST_SetSRID(ST_MakePoint(56.25, 26.57), 4326), '{"oil_flow": "high"}'),
('suez', 'canal',
  '{"en": "Suez Canal", "ar": "قناة السويس"}',
  '{"en": "Links the Mediterranean and the Red Sea.", "ar": "يربط البحر المتوسط بالبحر الأحمر."}',
  ST_SetSRID(ST_MakePoint(32.35, 30.60), 4326), '{}'),
('bab-el-mandeb', 'strait',
  '{"en": "Bab-el-Mandeb", "ar": "باب المندب"}',
  '{"en": "Gateway between the Red Sea and the Gulf of Aden.", "ar": "البوابة بين البحر الأحمر وخليج عدن."}',
  ST_SetSRID(ST_MakePoint(43.33, 12.58), 4326), '{}'),
('malacca', 'strait',
  '{"en": "Strait of Malacca", "ar": "مضيق ملقا"}',
  '{"en": "Busiest shipping lane between the Indian and Pacific oceans.", "ar": "أكثر الممرات ازدحاماً بين المحيطين الهندي والهادئ."}',
  ST_SetSRID(ST_MakePoint(100.40, 2.50), 4326), '{}'),
('panama', 'canal',
  '{"en": "Panama Canal", "ar": "قناة بنما"}',
  '{"en": "Links the Atlantic and Pacific oceans.", "ar": "يربط المحيطين الأطلسي والهادئ."}',
  ST_SetSRID(ST_MakePoint(-79.68, 9.08), 4326), '{}'),
('jebel-ali', 'port',
  '{"en": "Port of Jebel Ali", "ar": "ميناء جبل علي"}',
  '{"en": "Largest container port in the Middle East.", "ar": "أكبر ميناء حاويات في الشرق الأوسط."}',
  ST_SetSRID(ST_MakePoint(55.03, 24.98), 4326), '{}');

-- Read-only role for the API layer (PostgREST / FastAPI); no writes from the edge.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_anon') THEN
    CREATE ROLE geo_anon NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO geo_anon;
GRANT SELECT ON logistics_nodes TO geo_anon;
