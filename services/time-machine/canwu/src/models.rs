use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SimulationCommand {
    pub command_id: String,
    pub scenario: String,
    pub theme: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SimulationResult {
    pub result_id: Uuid,
    pub command_id: String,
    pub scenario: String,
    pub status: String,
    pub event_count: i32,
    pub duration_ms: i64,
    pub output: serde_json::Value,
    pub completed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub uptime_seconds: u64,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub commands_processed: u64,
    pub simulations_completed: u64,
    pub errors_total: u64,
    pub avg_duration_ms: f64,
}
