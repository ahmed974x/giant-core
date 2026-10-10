# Giant Core Workstation

A Streamlit app for local Python code analysis and plugin management.

## Setup

- **Runtime**: Python 3.12 (via `python:3.12-slim` in `docker-compose.base44.yml`)
- **Dependencies**: `streamlit>=1.40,<2` (see `requirements.txt`)
- **Source files**: `app.py` (UI) + `plugin_manager.py` (local analysis engine)
- **No external credentials required** — the app is fully self-contained.

## Running

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

The Streamlit dev server runs on port 3000 with live reload (`--server.runOnSave=true`, poll watcher for bind-mount compatibility).

## Health check

Streamlit exposes `/_stcore/health` — returns `ok` when the server is ready.

## Notes

- Static background images (`/manus-storage/*.png`) are referenced in CSS but not bundled; the app works without them (backgrounds simply won't render).
- `plugin_manager.py` runs user-submitted Python in an isolated subprocess with a 10-second timeout. The `plugins/` directory is created on first merge.
