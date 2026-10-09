# Canwu - High-Throughput Event Processing Engine

Canwu is a Rust-based event orchestration and stream processing service designed for the OMEGA PRIME Time Machine simulation pipeline.

## Features

- **Redis Stream Integration**: Consume simulation commands from Redis Streams.
- **High-Throughput Processing**: Async Tokio-based architecture for concurrent command processing.
- **Metrics & Observability**: Prometheus-compatible metrics and structured logging.
- **REST API**: Health checks, metrics, and status endpoints.
- **PostgreSQL Integration**: Store and query simulation results.

## Building

```bash
cd services/time-machine/canwu
cargo build --release
```

## Running

```bash
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/omega_prime
export CANWU_PORT=8081

cargo run --release
```

## Configuration

Environment variables:

- `CANWU_HOST`: Server bind address (default: 0.0.0.0)
- `CANWU_PORT`: Server port (default: 8081)
- `REDIS_URL`: Redis connection string
- `TIME_MACHINE_COMMAND_STREAM`: Redis stream for commands
- `TIME_MACHINE_RESULT_STREAM`: Redis stream for results
- `DATABASE_URL`: PostgreSQL connection string
- `LOG_LEVEL`: Logging level (default: info)
- `WORKER_THREADS`: Number of worker threads (default: CPU count)

## API Endpoints

- `GET /health`: Health check
- `GET /metrics`: Prometheus metrics
- `GET /status`: Service status
