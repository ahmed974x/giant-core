# Newton (مخ نيوتن)

OMEGA's math/physics engine. The AI never guesses a number: it calls Newton, and every answer
returns its **inputs, formula, assumptions and raw evidence links** so Ahmad can check it.

| Tool | What it answers | Data |
|---|---|---|
| `newton_ship_eta` | When does a ship reach a port/island | AIS position + SOG, WGS84 Vincenty legs, optional live surface current (Open-Meteo marine, keyless) |
| `newton_road_eta` | When does a car arrive | OSRM over OpenStreetMap (keyless), `traffic_factor` for rush hour |
| `newton_distance` | Exact distance + bearing on Earth | WGS84 ellipsoid (mm accuracy) |
| `newton_calc` / `newton_solve` | Exact maths (integrals, roots, 100-digit decimals) | SymPy, sandboxed |
| `newton_kinematics` | F = m·a motion: any 3 of s,u,v,a,t | SymPy |

## Run

```bash
pip install -r newton/requirements.txt
python -m newton.http_api      # site page + JSON API on http://127.0.0.1:8095
python -m newton.mcp_server    # MCP (stdio) for Claude Desktop / Claude Code
python -m pytest -q newton/tests
```

Claude Desktop (`claude_desktop_config.json`), Windows laptop:

```json
"omega-newton": {
  "command": "python",
  "args": ["-m", "newton.mcp_server"],
  "cwd": "C:\\Users\\Hp\\Desktop\\OMEGA_PRIME_PROJECT"
}
```

Env: `NEWTON_OSRM_URL` (default public demo `router.project-osrm.org`; self-host OSRM in Docker for
unlimited use), `NEWTON_MARINE_URL`, `NEWTON_HOST`/`NEWTON_PORT`.

## Honest limits

- Ship ETA uses straight geodesic legs; pass `waypoints` for straits/lanes. AIS SOG already includes current.
- Road ETA is free-flow (OSM speed profiles), not live traffic.
- Not built: a "Navier-Stokes market predictor". Fluid analogies for markets are not deterministic;
  any such model would be an experimental paper-trading signal only (see ADR-062).
