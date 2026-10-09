#!/bin/bash

##############################################################################
# Time Machine Service Startup Script
# 
# This script initializes the GDELT ingestor and Time Machine Agent (Bot 09)
# within the OMEGA PRIME ecosystem.
##############################################################################

set -euo pipefail

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[TIME-MACHINE]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[TIME-MACHINE]${NC} $1"
}

log_error() {
    echo -e "${RED}[TIME-MACHINE]${NC} $1" >&2
}

##############################################################################
# Configuration
##############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../" && pwd)"

PYTHON_VERSION_MIN="3.10"
PYTHON_CMD="python3"

# Environment file
ENV_FILE="${PROJECT_ROOT}/.env.time-machine"
if [ -f "$ENV_FILE" ]; then
    log_info "Loading environment from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
else
    log_warn "No .env.time-machine file found; using defaults."
fi

# Set defaults if not already set
export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_DB="${POSTGRES_DB:-omega_prime}"
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export TIME_MACHINE_COMMAND_STREAM="${TIME_MACHINE_COMMAND_STREAM:-omega:simulation:commands}"
export TIME_MACHINE_RESULT_STREAM="${TIME_MACHINE_RESULT_STREAM:-omega:simulation:results}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

##############################################################################
# Validation
##############################################################################

log_info "Validating environment..."

# Check Python version
if ! command -v "$PYTHON_CMD" &> /dev/null; then
    log_error "Python 3 not found. Please install Python $PYTHON_VERSION_MIN or higher."
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
log_info "Using Python: $PYTHON_VERSION"

# Check PostgreSQL connectivity
log_info "Checking PostgreSQL connectivity at $POSTGRES_HOST:$POSTGRES_PORT..."
if ! nc -z "$POSTGRES_HOST" "$POSTGRES_PORT" 2>/dev/null; then
    log_error "Cannot connect to PostgreSQL at $POSTGRES_HOST:$POSTGRES_PORT"
    exit 1
fi
log_info "PostgreSQL connectivity verified."

# Check Redis connectivity
log_info "Checking Redis connectivity at $REDIS_HOST:$REDIS_PORT..."
if ! nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
    log_error "Cannot connect to Redis at $REDIS_HOST:$REDIS_PORT"
    exit 1
fi
log_info "Redis connectivity verified."

##############################################################################
# Virtual Environment Setup
##############################################################################

VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
    log_info "Creating Python virtual environment at $VENV_DIR..."
    "$PYTHON_CMD" -m venv "$VENV_DIR"
else
    log_info "Virtual environment already exists at $VENV_DIR."
fi

# Activate virtual environment
log_info "Activating virtual environment..."
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

##############################################################################
# Dependencies Installation
##############################################################################

log_info "Installing Python dependencies from requirements.txt..."
pip install --upgrade pip setuptools wheel > /dev/null 2>&1
pip install -r "$SCRIPT_DIR/requirements.txt"
log_info "Dependencies installed successfully."

##############################################################################
# Database Migration
##############################################################################

log_info "Running database migrations..."

if [ ! -f "$SCRIPT_DIR/migrations/schema.sql" ]; then
    log_error "Migration file not found at $SCRIPT_DIR/migrations/schema.sql"
    exit 1
fi

# Execute migration using psql (requires PGPASSWORD to be set)
export PGPASSWORD="$POSTGRES_PASSWORD"

psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$SCRIPT_DIR/migrations/schema.sql" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    log_info "Database migrations completed."
else
    log_error "Database migration failed."
    exit 1
fi

unset PGPASSWORD

##############################################################################
# Service Startup
##############################################################################

log_info "========================================"
log_info "Starting OMEGA PRIME Time Machine Engine"
log_info "========================================"
log_info "PostgreSQL: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
log_info "Redis: $REDIS_HOST:$REDIS_PORT"
log_info "Command Stream: $TIME_MACHINE_COMMAND_STREAM"
log_info "Result Stream: $TIME_MACHINE_RESULT_STREAM"
log_info "Log Level: $LOG_LEVEL"
log_info "========================================"

# Run the Time Machine Agent
log_info "Launching Time Machine Agent (Bot 09)..."
cd "$SCRIPT_DIR"
exec "$PYTHON_CMD" -u time_machine_agent.py
