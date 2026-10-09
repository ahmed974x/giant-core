use serde::{Deserialize, Serialize};
use std::env;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Config {
    pub server_host: String,
    pub server_port: u16,
    pub redis_url: String,
    pub redis_stream_commands: String,
    pub redis_stream_results: String,
    pub postgres_dsn: String,
    pub log_level: String,
    pub worker_threads: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Config {
            server_host: env::var("CANWU_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            server_port: env::var("CANWU_PORT")
                .unwrap_or_else(|_| "8081".to_string())
                .parse()?,
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            redis_stream_commands: env::var("TIME_MACHINE_COMMAND_STREAM")
                .unwrap_or_else(|_| "omega:simulation:commands".to_string()),
            redis_stream_results: env::var("TIME_MACHINE_RESULT_STREAM")
                .unwrap_or_else(|_| "omega:simulation:results".to_string()),
            postgres_dsn: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/omega_prime".to_string()),
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
            worker_threads: env::var("WORKER_THREADS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(num_cpus::get),
        })
    }
}
