//! Canwu - High-throughput event processing engine for OMEGA PRIME Time Machine.
//!
//! This service orchestrates scenario replay commands from Redis Streams,
//! coordinates with the GDELT ingestor, and manages simulation result persistence.

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use redis::aio::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::signal;
use tracing::{error, info, warn};

mod config;
mod models;
mod streams;
mod handlers;
mod metrics;

use config::Config;
use models::SimulationCommand;

#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    redis: Arc<tokio::sync::Mutex<Connection>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("Starting Canwu event processing engine");

    // Load configuration
    let config = Config::from_env()?;
    info!("Configuration loaded: {:?}", config);

    // Initialize Redis connection
    let redis_client = redis::Client::open(config.redis_url.clone())?;
    let redis_conn = redis_client.get_async_connection().await?;

    let state = AppState {
        config: Arc::new(config.clone()),
        redis: Arc::new(tokio::sync::Mutex::new(redis_conn)),
    };

    // Initialize metrics
    metrics::init();

    // Build router
    let app = Router::new()
        .route("/health", get(handlers::health::health_check))
        .route("/metrics", get(handlers::metrics::metrics_endpoint))
        .route("/status", get(handlers::status::status_endpoint))
        .with_state(state.clone());

    // Start server
    let addr = format!("{}:{}", config.server_host, config.server_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Server listening on {}", addr);

    // Spawn command listener
    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = streams::listen_for_commands(state_clone).await {
            error!("Command listener error: {:?}", e);
        }
    });

    // Handle graceful shutdown
    let shutdown = async {
        let _ = signal::ctrl_c().await;
        info!("Shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    info!("Canwu service shut down gracefully");
    Ok(())
}
