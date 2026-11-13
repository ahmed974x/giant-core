"""Cinematic presets (ADR-157): the same engine as jarvis/server/lib/cinematic-presets.mjs, standard library only.

A preset is a set of starting values for a shot (focal length, f-stop, subject distance, aspect ratio, three
light temperatures and the corner the golden spiral turns into). They are conventions, not measurements, and
carry [INFERENCE]. From them it computes the thin-lens optics (hyper_studio.py), each light's colour as text
on the theme's surface checked against WCAG 4.5 and APCA Lc 60 and healed with the ADR-153 bisection
(reversal_engine.py), and the golden-section composition drawn as plain SVG in the accent. No network, no
process. For the same request it returns the same JSON as the server.

    python3 cinematic_presets.py list
    python3 cinematic_presets.py run '{"preset":"golden_hour_5200k","theme":"light"}'
    python3 cinematic_presets.py svg '{"preset":"desert_dusk"}' > dusk.svg
"""
import argparse
import json
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [_HERE, os.path.join(os.path.dirname(_HERE), "replica-reversal-engine")]
from hyper_studio import ACCENT, HyperError, _js_num_str, optics  # noqa: E402
from reversal_engine import heal_oklch_contrast  # noqa: E402

CP_CATEGORIES = ["angles", "lighting", "atmosphere", "art"]
CP_SURFACE = {"dark": "#10141b", "light": "#ffffff"}
PHI = (1 + math.sqrt(5)) / 2
_ROWS = [
    ("cinematic_anamorphic", "angles", 50, 2.8, 4, [2.39, 1], 5600, 4300, 3200, "br", "Anamorphic widescreen", "شاشة عريضة أنامورفية"),
    ("drone_aerial", "angles", 24, 5.6, 60, [16, 9], 5600, 6500, 5600, "tr", "Drone aerial", "لقطة جوية بطائرة مسيّرة"),
    ("low_angle_hero", "angles", 24, 4, 2, [16, 9], 4300, 5600, 3200, "bl", "Low angle hero", "زاوية منخفضة للبطل"),
    ("macro_closeup", "angles", 100, 8, 0.3, [3, 2], 5600, 5000, 4300, "tl", "Macro close-up", "لقطة ماكرو قريبة"),
    ("isometric_grid", "angles", 200, 8, 30, [1, 1], 6500, 6500, 6500, "br", "Isometric grid", "شبكة متساوية القياس"),
    ("tilt_shift_miniature", "angles", 45, 2.8, 20, [3, 2], 5600, 6000, 4800, "tr", "Tilt-shift miniature", "منمنمة بإمالة العدسة"),
    ("dramatic_chiaroscuro", "lighting", 85, 1.8, 3, [4, 3], 3200, 4300, 2700, "bl", "Dramatic chiaroscuro", "ضوء وظل دراميان"),
    ("rim_backlight", "lighting", 85, 2, 3, [16, 9], 5600, 4300, 3200, "br", "Rim backlight", "إضاءة خلفية محيطية"),
    ("volumetric_rays", "lighting", 35, 5.6, 8, [16, 9], 5000, 6500, 4000, "tr", "Volumetric rays", "أشعة حجمية"),
    ("golden_hour_5200k", "lighting", 50, 2.8, 5, [16, 9], 5200, 4500, 3500, "tl", "Golden hour 5200 K", "الساعة الذهبية 5200 كلفن"),
    ("blue_hour_7500k", "lighting", 35, 4, 10, [16, 9], 7500, 9000, 6500, "tr", "Blue hour 7500 K", "الساعة الزرقاء 7500 كلفن"),
    ("studio_three_point", "lighting", 85, 8, 2.5, [4, 5], 5600, 4500, 3200, "br", "Studio three-point", "إضاءة الاستوديو الثلاثية"),
    ("dense_fog", "atmosphere", 35, 4, 15, [16, 9], 6500, 7000, 6000, "bl", "Dense fog", "ضباب كثيف"),
    ("rainy_night_reflections", "atmosphere", 35, 1.8, 6, [2.39, 1], 3200, 6500, 2700, "br", "Rainy night reflections", "انعكاسات ليلة ماطرة"),
    ("snow_minimal", "atmosphere", 50, 8, 20, [3, 2], 7000, 8000, 6500, "tl", "Snow, minimal", "ثلج بأقل العناصر"),
    ("desert_dusk", "atmosphere", 135, 5.6, 50, [2.39, 1], 3800, 4500, 3000, "tr", "Desert dusk", "غسق الصحراء"),
    ("blueprint_sketch", "art", 50, 11, 3, [3, 2], 6500, 6500, 6500, "tl", "Blueprint sketch", "مخطط أزرق"),
    ("liquid_glass_art", "art", 85, 2, 1, [1, 1], 6000, 5000, 4500, "br", "Liquid glass", "زجاج سائل"),
    ("monochrome_noir", "art", 35, 2.8, 3, [4, 3], 4000, 6500, 3200, "bl", "Monochrome noir", "نوار أحادي اللون"),
    ("paper_cutout_layers", "art", 50, 5.6, 2, [4, 3], 5000, 5600, 4300, "tr", "Paper cut-out layers", "طبقات ورق مقصوص"),
    ("wireframe_cad", "art", 200, 16, 10, [16, 9], 6500, 6500, 6500, "br", "Wireframe CAD", "إطار سلكي هندسي"),
]
CINEMATIC_PRESETS = [{"id": i, "category": c, "focal_mm": f, "f_stop": n, "subject_m": s, "aspect": a, "kelvin": {"key": k, "fill": fl, "rim": rm},
                      "spiral": sp, "title": {"en": en, "ar": ar}} for i, c, f, n, s, a, k, fl, rm, sp, en, ar in _ROWS]


def cp_r(v, d=2):
    """Math.round(v * 10^d) / 10^d as JavaScript computes it, -0 as 0, whole numbers as int."""
    p = 10 ** d
    x = math.floor(v * p + 0.5) / p
    if x == 0:
        x = 0.0
    return int(x) if x.is_integer() else x


def frame_of(aspect):
    return {"w": 640, "h": cp_r(640 * aspect[1] / aspect[0])}


def golden_rect(w, h):
    gw = min(w, h * PHI)
    gh = gw / PHI
    return {"x": (w - gw) / 2, "y": (h - gh) / 2, "w": gw, "h": gh}


def golden_spiral(rect, n=10):
    x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
    arcs = []
    for i in range(n):
        side = i % 4
        if side == 0:
            s = h
            arcs.append({"from": [x, y + s], "to": [x + s, y], "c": [x + s, y + s], "r": s})
            x += s
            w -= s
        elif side == 1:
            s = w
            arcs.append({"from": [x, y], "to": [x + s, y + s], "c": [x, y + s], "r": s})
            y += s
            h -= s
        elif side == 2:
            s = h
            arcs.append({"from": [x + w, y], "to": [x + (w - s), y + s], "c": [x + (w - s), y], "r": s})
            w -= s
        else:
            s = w
            arcs.append({"from": [x + w, y + h], "to": [x, y + (h - s)], "c": [x + w, y + (h - s)], "r": s})
            h -= s
    return {"arcs": arcs, "rest": {"x": x, "y": y, "w": w, "h": h}}


def spiral_eye(rect):
    x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
    a, b, c, d = [x, y], [x + w, y + h], [x + h, y + h], [x + w, y]
    den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0])
    t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]


def mirror_point(p, corner, w, h):
    return [w - p[0] if corner[1] == "l" else p[0], h - p[1] if corner[0] == "t" else p[1]]


CP_EPS = {"radius": 2 ** -30, "frame": 2 ** -20}


def arcs_join(arcs):
    return all(i == 0 or (a["from"][0] == arcs[i - 1]["to"][0] and a["from"][1] == arcs[i - 1]["to"][1]) for i, a in enumerate(arcs))


def arcs_round(arcs):
    return all(abs(math.hypot(a["from"][0] - a["c"][0], a["from"][1] - a["c"][1]) - a["r"]) <= CP_EPS["radius"] * a["r"]
               and abs(math.hypot(a["to"][0] - a["c"][0], a["to"][1] - a["c"][1]) - a["r"]) <= CP_EPS["radius"] * a["r"] for a in arcs)


def inside_frame(points, w, h):
    e = CP_EPS["frame"]
    return all(-e <= x <= w + e and -e <= y <= h + e for x, y in points)


def closes_on_eye(rest, eye, width):
    return all(math.hypot(x - eye[0], y - eye[1]) <= width / 100 for x, y in ((rest["x"], rest["y"]), (rest["x"] + rest["w"], rest["y"] + rest["h"])))


def sweep_of(a):
    u = [a["from"][0] - a["c"][0], a["from"][1] - a["c"][1]]
    v = [a["to"][0] - a["c"][0], a["to"][1] - a["c"][1]]
    return 1 if u[0] * v[1] - u[1] * v[0] > 0 else 0


def composition(preset):
    fr = frame_of(preset["aspect"])
    w, h = fr["w"], fr["h"]
    g = golden_rect(w, h)
    sp = golden_spiral(g)
    e0 = spiral_eye(g)

    def m(p):
        return mirror_point(p, preset["spiral"], w, h)

    arcs = [{"from": m(a["from"]), "to": m(a["to"]), "c": m(a["c"]), "r": a["r"]} for a in sp["arcs"]]
    eye = m(e0)
    pts = [p for a in arcs for p in (a["from"], a["to"], a["c"])] + [eye]
    checks = [
        {"text": "Each quarter circle of the spiral starts where the last one ended.", "ok": arcs_join(arcs)},
        {"text": "Each arc's ends lie on its circle.", "ok": arcs_round(arcs)},
        {"text": "The spiral and the subject point stay inside the frame.", "ok": inside_frame(pts, w, h)},
        {"text": "The spiral closes on the subject point, where the golden rectangle's diagonals cross.", "ok": closes_on_eye(sp["rest"], e0, g["w"])},
    ]
    return {"w": w, "h": h, "lines": {"x": [cp_r(w / PHI / PHI), cp_r(w / PHI)], "y": [cp_r(h / PHI / PHI), cp_r(h / PHI)]},
            "arcs": [{"from": [cp_r(v) for v in a["from"]], "to": [cp_r(v) for v in a["to"]], "r": cp_r(a["r"]), "sweep": sweep_of(a)} for a in arcs],
            "eye": [cp_r(v) for v in eye], "checks": checks}


def _s(v):
    return _js_num_str(v)


def cinematic_svg(c, dof, subject, theme):
    a = ACCENT["light" if theme == "light" else "dark"]
    H = c["h"] + 40
    scale = (c["w"] - 40) / (2 * subject)
    near = 20 + min(dof["near_m"], 2 * subject) * scale
    far = 20 + (2 * subject if dof["far_m"] is None else min(dof["far_m"], 2 * subject)) * scale
    d = "M" + " ".join(_s(v) for v in c["arcs"][0]["from"]) + "".join(f" A{_s(x['r'])} {_s(x['r'])} 0 0 {x['sweep']} {' '.join(_s(v) for v in x['to'])}" for x in c["arcs"])
    w, h = c["w"], c["h"]
    parts = [f'<rect x="1" y="1" width="{_s(w - 2)}" height="{_s(cp_r(h - 2))}" fill="none" stroke="{a}" stroke-width="2"/>']
    parts += [f'<line x1="{_s(x)}" y1="0" x2="{_s(x)}" y2="{_s(h)}" stroke="{a}" stroke-opacity="0.45" stroke-width="1"/>' for x in c["lines"]["x"]]
    parts += [f'<line x1="0" y1="{_s(y)}" x2="{_s(w)}" y2="{_s(y)}" stroke="{a}" stroke-opacity="0.45" stroke-width="1"/>' for y in c["lines"]["y"]]
    parts += [
        f'<path d="{d}" fill="none" stroke="{a}" stroke-width="2"/>',
        f'<circle cx="{_s(c["eye"][0])}" cy="{_s(c["eye"][1])}" r="7" fill="{a}"/>',
        f'<line x1="20" y1="{_s(cp_r(h + 24))}" x2="{_s(w - 20)}" y2="{_s(cp_r(h + 24))}" stroke="{a}" stroke-opacity="0.45" stroke-width="2"/>',
        f'<rect x="{_s(cp_r(near))}" y="{_s(cp_r(h + 18))}" width="{_s(cp_r(max(1, far - near)))}" height="12" fill="{a}"/>',
        f'<line x1="{_s(cp_r(20 + subject * scale))}" y1="{_s(cp_r(h + 12))}" x2="{_s(cp_r(20 + subject * scale))}" y2="{_s(cp_r(h + 36))}" stroke="{a}" stroke-width="2"/>',
    ]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_s(w)} {_s(cp_r(H))}" width="{_s(w)}" height="{_s(cp_r(H))}" role="img" aria-hidden="true">{"".join(parts)}</svg>'


def compile_cinematic(req):
    r = req if isinstance(req, dict) else {}
    preset = next((p for p in CINEMATIC_PRESETS if p["id"] == r.get("preset")), None)
    if preset is None:
        raise HyperError("Choose one of the cinematic presets.", r.get("preset") if isinstance(r.get("preset"), str) else "")
    theme = "light" if r.get("theme") == "light" else "dark"
    subject = preset["subject_m"] if r.get("subject_distance_m") is None else r.get("subject_distance_m")
    o = optics({"focal_mm": preset["focal_mm"], "f_stop": preset["f_stop"], "subject_distance_m": subject, "sensor_width_mm": 36,
                "key_kelvin": preset["kelvin"]["key"], "fill_kelvin": preset["kelvin"]["fill"], "rim_kelvin": preset["kelvin"]["rim"]})
    surface = CP_SURFACE[theme]
    labels = {}
    for k in ("key", "fill", "rim"):
        h = heal_oklch_contrast(o["lights"][k]["hex"], surface)
        labels[k] = {"light": o["lights"][k]["hex"], "text": h["after"]["hex"] if h["ok"] else None, "healed": h["changed"],
                     "wcag": h["after"]["ratio"] if h["ok"] else None, "apca": h["after"]["lc"] if h["ok"] else None}
    c = composition(preset)
    checks = o["checks"] + c["checks"] + [{"text": "Each light's colour, as text on the surface, passes WCAG 4.5 and APCA Lc 60 (healed where needed, hue kept).",
                                           "ok": all(lb["text"] is not None for lb in labels.values())}]
    out = {"preset": preset["id"], "category": preset["category"], "title": preset["title"], "tag": "[INFERENCE]", "theme": theme, "accent": ACCENT[theme], "surface": surface,
           "aspect": preset["aspect"], "lens": o["lens"], "depth_of_field": o["depth_of_field"], "field_of_view_deg": o["field_of_view_deg"],
           "background_blur": o["background_blur"], "lights": o["lights"], "labels": labels,
           "composition": {"w": c["w"], "h": c["h"], "lines": c["lines"], "eye": c["eye"], "arcs": c["arcs"]}, "checks": checks,
           "verified": all(x["ok"] for x in checks)}
    out["svg"] = cinematic_svg(c, o["depth_of_field"], subject, theme)
    return out


def preset_list():
    return [{k: p[k] for k in ("id", "category", "title", "focal_mm", "f_stop", "subject_m", "aspect", "kelvin")} for p in CINEMATIC_PRESETS]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Cinematic presets: optics, healed light colours and golden-section composition (ADR-157).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    for name in ("run", "svg"):
        sub.add_parser(name).add_argument("request", help='a JSON request such as {"preset":"desert_dusk"}')
    a = ap.parse_args(argv)
    try:
        if a.cmd == "list":
            print(json.dumps(preset_list(), ensure_ascii=False))
            return 0
        out = compile_cinematic(json.loads(a.request))
        print(out["svg"] if a.cmd == "svg" else json.dumps(out, ensure_ascii=False))
        return 0
    except (HyperError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
