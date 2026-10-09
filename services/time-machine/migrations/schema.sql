-- ============================================================================
-- GDELT Historical Events Schema Migration
-- PostgreSQL with TimescaleDB Extension Support
-- Created: 2026-10-09
-- Version: 1.0
-- ============================================================================

-- ============================================================================
-- Ensure extensions are available
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- ============================================================================
-- Create GDELT Events Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS gdelt_events (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_date TIMESTAMPTZ NOT NULL,
    source_country TEXT,
    event_root_code TEXT,
    event_root_name TEXT,
    event_code TEXT,
    event_name TEXT,
    actor1_name TEXT,
    actor1_country_code TEXT,
    actor1_type TEXT,
    actor2_name TEXT,
    actor2_country_code TEXT,
    actor2_type TEXT,
    is_root_event BOOLEAN DEFAULT FALSE,
    quad_class INTEGER,
    goldstein_scale DOUBLE PRECISION,
    num_mentions INTEGER DEFAULT 0,
    num_sources INTEGER DEFAULT 0,
    num_articles INTEGER DEFAULT 0,
    avg_tone DOUBLE PRECISION,
    url TEXT,
    title TEXT,
    theme TEXT,
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Create Indexes for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_gdelt_events_event_date 
    ON gdelt_events (event_date DESC);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_theme 
    ON gdelt_events (theme);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_root_code 
    ON gdelt_events (event_root_code);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_source_country 
    ON gdelt_events (source_country);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_actor1_name 
    ON gdelt_events (actor1_name);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_actor2_name 
    ON gdelt_events (actor2_name);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_quad_class 
    ON gdelt_events (quad_class);

CREATE INDEX IF NOT EXISTS idx_gdelt_events_created_at 
    ON gdelt_events (created_at DESC);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_gdelt_events_theme_date 
    ON gdelt_events (theme, event_date DESC);

-- ============================================================================
-- Convert to TimescaleDB Hypertable (if extension is enabled)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'gdelt_events' 
        AND table_schema = 'public'
    ) THEN
        PERFORM create_hypertable('gdelt_events', 'event_date', if_not_exists => TRUE);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        -- If TimescaleDB is not enabled, this is still a valid PostgreSQL table
        -- The table will function normally, just without time-series optimizations
        RAISE NOTICE 'TimescaleDB extension not available; proceeding with standard PostgreSQL table.';
END $$;

-- ============================================================================
-- Create Simulation Results Table for Audit Trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS simulation_runs (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
    scenario_name TEXT NOT NULL,
    theme TEXT,
    command_text TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    event_count INTEGER,
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Create Indexes for Simulation Runs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_simulation_runs_status 
    ON simulation_runs (status);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_scenario_name 
    ON simulation_runs (scenario_name);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_created_at 
    ON simulation_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_run_id 
    ON simulation_runs (run_id);

-- ============================================================================
-- Create Event Correlation Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_correlations (
    id BIGSERIAL PRIMARY KEY,
    source_event_id TEXT NOT NULL REFERENCES gdelt_events(event_id) ON DELETE CASCADE,
    related_event_id TEXT NOT NULL REFERENCES gdelt_events(event_id) ON DELETE CASCADE,
    correlation_score DOUBLE PRECISION,
    correlation_type VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_correlation UNIQUE (source_event_id, related_event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_correlations_source 
    ON event_correlations (source_event_id);

CREATE INDEX IF NOT EXISTS idx_event_correlations_related 
    ON event_correlations (related_event_id);

-- ============================================================================
-- Create Materialized Views for Reporting
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_summary AS
SELECT 
    DATE_TRUNC('day', event_date)::DATE as event_day,
    theme,
    event_root_code,
    COUNT(*) as event_count,
    AVG(goldstein_scale) as avg_scale,
    AVG(avg_tone) as avg_tone_sentiment,
    COUNT(DISTINCT source_country) as affected_countries
FROM gdelt_events
GROUP BY DATE_TRUNC('day', event_date), theme, event_root_code;

CREATE INDEX IF NOT EXISTS idx_mv_event_summary_day 
    ON mv_event_summary (event_day DESC);

-- ============================================================================
-- Create Stored Procedure for Event Query
-- ============================================================================

CREATE OR REPLACE FUNCTION query_events_by_theme(
    p_theme TEXT,
    p_start_date DATE,
    p_end_date DATE,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    event_id TEXT,
    event_date TIMESTAMPTZ,
    source_country TEXT,
    event_root_code TEXT,
    event_root_name TEXT,
    event_code TEXT,
    event_name TEXT,
    actor1_name TEXT,
    actor1_country_code TEXT,
    actor1_type TEXT,
    actor2_name TEXT,
    actor2_country_code TEXT,
    actor2_type TEXT,
    is_root_event BOOLEAN,
    quad_class INTEGER,
    goldstein_scale DOUBLE PRECISION,
    num_mentions INTEGER,
    num_sources INTEGER,
    num_articles INTEGER,
    avg_tone DOUBLE PRECISION,
    url TEXT,
    title TEXT,
    theme TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ge.event_id,
        ge.event_date,
        ge.source_country,
        ge.event_root_code,
        ge.event_root_name,
        ge.event_code,
        ge.event_name,
        ge.actor1_name,
        ge.actor1_country_code,
        ge.actor1_type,
        ge.actor2_name,
        ge.actor2_country_code,
        ge.actor2_type,
        ge.is_root_event,
        ge.quad_class,
        ge.goldstein_scale,
        ge.num_mentions,
        ge.num_sources,
        ge.num_articles,
        ge.avg_tone,
        ge.url,
        ge.title,
        ge.theme
    FROM gdelt_events ge
    WHERE ge.theme ILIKE ('%' || p_theme || '%')
        AND ge.event_date::DATE >= p_start_date
        AND ge.event_date::DATE <= p_end_date
    ORDER BY ge.event_date DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create Stored Procedure for Simulation Result Recording
-- ============================================================================

CREATE OR REPLACE FUNCTION record_simulation_run(
    p_scenario_name TEXT,
    p_theme TEXT,
    p_command_text TEXT,
    p_event_count INT,
    p_result JSONB
)
RETURNS TABLE (
    run_id UUID,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    v_run_id UUID;
BEGIN
    INSERT INTO simulation_runs (
        scenario_name,
        theme,
        command_text,
        status,
        start_time,
        event_count,
        result
    ) VALUES (
        p_scenario_name,
        p_theme,
        p_command_text,
        'completed',
        NOW(),
        p_event_count,
        p_result
    ) RETURNING simulation_runs.run_id, simulation_runs.created_at INTO v_run_id, FOUND;
    
    RETURN QUERY SELECT v_run_id, NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant Permissions (adjust roles as needed)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON gdelt_events TO postgres;
GRANT SELECT, INSERT, UPDATE ON simulation_runs TO postgres;
GRANT SELECT, INSERT, UPDATE ON event_correlations TO postgres;
GRANT EXECUTE ON FUNCTION query_events_by_theme TO postgres;
GRANT EXECUTE ON FUNCTION record_simulation_run TO postgres;

-- ============================================================================
-- Audit Trail: Log schema changes
-- ============================================================================

INSERT INTO information_schema.schemata (schema_name) 
SELECT 'time_machine_v1' 
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'time_machine_v1'
);

COMMENT ON TABLE gdelt_events IS 'Global Data on Events, Language, and Tone (GDELT) historical event records for Time Machine scenario simulation.';
COMMENT ON TABLE simulation_runs IS 'Audit trail for all simulation and scenario replay executions.';
COMMENT ON TABLE event_correlations IS 'Correlation relationships between related GDELT events for graph analysis.';
COMMENT ON FUNCTION query_events_by_theme(TEXT, DATE, DATE, INT) IS 'Query historical GDELT events by theme and date range.';
