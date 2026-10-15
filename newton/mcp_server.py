"""Newton MCP server (stdio) for Claude Desktop / Claude Code. Read-only: it only computes.

Run:  python -m newton.mcp_server
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import calc, eta, geo

server = MCPServer(
    "omega-newton",
    instructions=(
        "Newton is OMEGA's math/physics engine. Never guess a number: call these tools and show the user "
        "the returned inputs, formula, assumptions and evidence links. Coordinates are decimal degrees (lat, lon)."
    ),
)


@server.tool()
def newton_calc(expression: str, digits: int = 30, subs: dict[str, float] | None = None) -> dict:
    """Evaluate a maths expression exactly (SymPy), e.g. 'integrate(sin(x)^2, (x, 0, pi))' or 'sqrt(2)'.
    Optional subs gives variable values, e.g. {"x": 3}."""
    return calc.evaluate(expression, digits, subs)


@server.tool()
def newton_solve(equation: str, variable: str | None = None) -> dict:
    """Solve an equation exactly, e.g. 'x^2 - 5x + 6 = 0' (variable 'x')."""
    return calc.solve(equation, variable)


@server.tool()
def newton_kinematics(s: float | None = None, u: float | None = None, v: float | None = None,
                      a: float | None = None, t: float | None = None) -> dict:
    """Constant-acceleration motion (Newton's 2nd law). Give any 3 of: s distance m, u start m/s,
    v end m/s, a m/s^2, t seconds. Returns the rest."""
    return calc.kinematics(s=s, u=u, v=v, a=a, t=t)


@server.tool()
def newton_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> dict:
    """Exact distance and bearing between two points on Earth (WGS84 ellipsoid, Vincenty)."""
    r = geo.inverse(lat1, lon1, lat2, lon2)
    r.update(distance_km=r["distance_m"] / 1000, distance_nm=r["distance_m"] / geo.NM)
    return r


@server.tool()
def newton_ship_eta(lat: float, lon: float, dest_lat: float, dest_lon: float, speed_kn: float,
                    waypoints: list[list[float]] | None = None, speed_is_sog: bool = True,
                    use_currents: bool = False, depart_utc: str | None = None) -> dict:
    """When a ship reaches a place. Use AIS position + SOG (knots). Add waypoints [[lat,lon],...] for straits.
    use_currents fetches the live surface current (Open-Meteo marine) to correct speed through water."""
    wps = [tuple(p) for p in waypoints] if waypoints else None
    return eta.ship_eta(lat, lon, dest_lat, dest_lon, speed_kn, wps, speed_is_sog, use_currents, depart_utc)


@server.tool()
def newton_road_eta(lat: float, lon: float, dest_lat: float, dest_lon: float, profile: str = "driving",
                    traffic_factor: float = 1.0, depart_utc: str | None = None) -> dict:
    """When a car (or bike/walker) arrives, routed over OpenStreetMap roads (OSRM).
    traffic_factor >1 slows free-flow time for rush hour (e.g. 1.4)."""
    return eta.road_eta(lat, lon, dest_lat, dest_lon, profile, None, depart_utc, traffic_factor)


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
