---
name: replica-hyper-studio
description: Draws shapes from 3 to 8 dimensions as plain SVG and checks them - a cube (SO(3), painter's sort, OKLCH face shading), a tesseract and a 16-cell (SO(4) rotations in the six planes, perspective R4 to R3 to R2), the 8-cube (Petrie projection, 16-fold) and the 240 roots of E8 in the Coxeter plane (30-fold) - plus thin-lens camera optics (depth of field, hyperfocal distance, field of view, background blur, EV100, Kelvin to colour) and grid game physics (A* checked against breadth-first search, Verlet particles). Standard-library Python only; no network, no processes, no outside library.
---

# replica-hyper-studio

```bash
python3 .claude/skills/replica-hyper-studio/hyper_studio.py run request.json
echo '{"mode":"projection","polytope":"e8_lattice","angles":{"xy":15}}' | python3 .claude/skills/replica-hyper-studio/hyper_studio.py svg - > e8.svg
python3 -m unittest discover -s .claude/skills/replica-hyper-studio/tests
```

| Mode | Request | What it does | Checked by |
| --- | --- | --- | --- |
| `projection` | `polytope` (`cube`, `tesseract`, `16cell`, `octeract`, `e8_lattice`), `angles` in degrees per plane (`xy`, `zw`, … with the axes x y z w u v s t), `theme` | rotates in the chosen planes and projects; the cube's faces are sorted back to front and shaded in OKLCH from the accent (`#77bcff` dark, `#0b5ed7` light) | edge lengths and distances kept; 16/32, 8/24, 256/1024 and 240/6720 vertices and edges with the right degree; for E8, a Coxeter element of order 30, the plane as the double eigenvalue 2 cos(2π/30) of c + cᵀ, and 8 rings of 30 roots |
| `optics` | `focal_mm`, `f_stop`, `subject_distance_m`, `sensor_width_mm`, `iso`, `shutter_s`, `key_kelvin`, `fill_kelvin`, `rim_kelvin` | thin-lens near and far limits with a circle of confusion of diagonal / 1500, hyperfocal distance, field of view, background blur disc, EV100, and each light's colour from the Planckian locus (Kim et al., 2002) as hex, OKLCH and mireds | near before and far after the subject; the subject is the harmonic mean of the limits; EV100 read back gives the shutter time |
| `game_physics` | `grid_size` (up to 40 × 40), `start`, `goal`, `obstacles`, `particles` (`x`, `y`, `vx`, `vy`, `radius`, up to 24), `ticks` (up to 600), `gravity` | A* with four moves and the Manhattan distance; Verlet integration with wall bounces and equal-mass collisions | A*'s length equals breadth-first search's, one step at a time and never through an obstacle; every particle stays in the box; no overlap above 0.01 of a cell |

The same maths runs in Jarvis (`jarvis/server/lib/hyper-studio.mjs`, `POST /api/w/:slug/studio/hyper`, the Hyper studio page). `tests/golden.json` holds the server's answers, and both test suites compare against it.

## Limits

- The drawings are projections: depth is lost, and the 8D pictures are one chosen plane among many.
- Optics are the thin-lens model; a real lens's focus breathing, pupil and diffraction are not modelled.
- The physics is a teaching model with unit time steps; it is not a game engine.
