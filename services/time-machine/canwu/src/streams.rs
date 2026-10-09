use crate::AppState;
use redis::aio::Connection;
use redis::AsyncCommands;
use serde_json::json;
use tracing::{error, info};

pub async fn listen_for_commands(state: AppState) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting command stream listener");

    loop {
        let mut conn = state.redis.lock().await.clone();
        let stream_name = state.config.redis_stream_commands.clone();

        match conn
            .xread::<&str, &str, Vec<(String, Vec<(String, String)>)>>(&[
                (&stream_name, "$"),
            ])
            .await
        {
            Ok(entries) => {
                for (key, messages) in entries {
                    info!("Received {} messages from stream: {}", messages.len(), key);
                    for (msg_id, fields) in messages {
                        info!("Processing command: {}", msg_id);
                        // Command processing logic here
                    }
                }
            }
            Err(e) => {
                error!("Stream read error: {:?}", e);
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}
