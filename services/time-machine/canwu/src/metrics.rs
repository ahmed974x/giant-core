use metrics::{counter, gauge};

pub fn init() {
    // Initialize metrics exporter for Prometheus
    let metrics_endpoint = std::env::var("METRICS_ENDPOINT").unwrap_or_else(|_| "0.0.0.0:9090".to_string());
    // Setup would go here
}

pub fn record_command_processed() {
    counter!("canwu_commands_processed_total").increment(1);
}

pub fn record_simulation_completed(duration_ms: u64) {
    counter!("canwu_simulations_completed_total").increment(1);
    gauge!("canwu_last_simulation_duration_ms").set(duration_ms as f64);
}

pub fn record_error() {
    counter!("canwu_errors_total").increment(1);
}
