// Cinematic presets (ADR-157), pure: used by the server (GET /api/w/:slug/studio/cinematic/presets and
// POST /api/w/:slug/studio/cinematic) and inlined into the page beside the hyper studio. A preset is a set of
// starting values for a shot: focal length, f-stop, subject distance, aspect ratio, three light temperatures
// and which corner the golden spiral turns into. They are conventions, not measurements, and carry
// [INFERENCE]. Everything computed from them is computed, not chosen:
//   - the optics come from hyper-studio.mjs (thin lens, depth of field, hyperfocal, EV100, Kelvin to OKLCH);
//   - each light's colour, used as text on the theme's surface, is checked against WCAG 4.5 and APCA Lc 60
//     and healed by the ADR-153 bisection when it fails, hue kept;
//   - the composition is the golden section of the frame: the lines at 1/φ² and 1/φ, and a golden spiral of
//     quarter circles in the largest golden rectangle that fits, ending at the point the subject sits on.
// The drawing is plain SVG in the accent (#77bcff dark, #0b5ed7 light): no gradient, no text, nothing moves.
import { optics, HS_ACCENT, HyperError } from "./hyper-studio.mjs";
import { healOklchContrast } from "./contrast-heal.mjs";

export const CP_CATEGORIES = ["angles", "lighting", "atmosphere", "art"];
export const CP_SURFACE = { dark: "#10141b", light: "#ffffff" };
export const PHI = (1 + Math.sqrt(5)) / 2;
// id, category, focal mm, f-stop, subject m, aspect [w, h], key / fill / rim K, spiral corner, English and Arabic names.
export const CINEMATIC_PRESETS = [
  ["cinematic_anamorphic", "angles", 50, 2.8, 4, [2.39, 1], 5600, 4300, 3200, "br", "Anamorphic widescreen", "شاشة عريضة أنامورفية"],
  ["drone_aerial", "angles", 24, 5.6, 60, [16, 9], 5600, 6500, 5600, "tr", "Drone aerial", "لقطة جوية بطائرة مسيّرة"],
  ["low_angle_hero", "angles", 24, 4, 2, [16, 9], 4300, 5600, 3200, "bl", "Low angle hero", "زاوية منخفضة للبطل"],
  ["macro_closeup", "angles", 100, 8, 0.3, [3, 2], 5600, 5000, 4300, "tl", "Macro close-up", "لقطة ماكرو قريبة"],
  ["isometric_grid", "angles", 200, 8, 30, [1, 1], 6500, 6500, 6500, "br", "Isometric grid", "شبكة متساوية القياس"],
  ["tilt_shift_miniature", "angles", 45, 2.8, 20, [3, 2], 5600, 6000, 4800, "tr", "Tilt-shift miniature", "منمنمة بإمالة العدسة"],
  ["dramatic_chiaroscuro", "lighting", 85, 1.8, 3, [4, 3], 3200, 4300, 2700, "bl", "Dramatic chiaroscuro", "ضوء وظل دراميان"],
  ["rim_backlight", "lighting", 85, 2, 3, [16, 9], 5600, 4300, 3200, "br", "Rim backlight", "إضاءة خلفية محيطية"],
  ["volumetric_rays", "lighting", 35, 5.6, 8, [16, 9], 5000, 6500, 4000, "tr", "Volumetric rays", "أشعة حجمية"],
  ["golden_hour_5200k", "lighting", 50, 2.8, 5, [16, 9], 5200, 4500, 3500, "tl", "Golden hour 5200 K", "الساعة الذهبية 5200 كلفن"],
  ["blue_hour_7500k", "lighting", 35, 4, 10, [16, 9], 7500, 9000, 6500, "tr", "Blue hour 7500 K", "الساعة الزرقاء 7500 كلفن"],
  ["studio_three_point", "lighting", 85, 8, 2.5, [4, 5], 5600, 4500, 3200, "br", "Studio three-point", "إضاءة الاستوديو الثلاثية"],
  ["dense_fog", "atmosphere", 35, 4, 15, [16, 9], 6500, 7000, 6000, "bl", "Dense fog", "ضباب كثيف"],
  ["rainy_night_reflections", "atmosphere", 35, 1.8, 6, [2.39, 1], 3200, 6500, 2700, "br", "Rainy night reflections", "انعكاسات ليلة ماطرة"],
  ["snow_minimal", "atmosphere", 50, 8, 20, [3, 2], 7000, 8000, 6500, "tl", "Snow, minimal", "ثلج بأقل العناصر"],
  ["desert_dusk", "atmosphere", 135, 5.6, 50, [2.39, 1], 3800, 4500, 3000, "tr", "Desert dusk", "غسق الصحراء"],
  ["blueprint_sketch", "art", 50, 11, 3, [3, 2], 6500, 6500, 6500, "tl", "Blueprint sketch", "مخطط أزرق"],
  ["liquid_glass_art", "art", 85, 2, 1, [1, 1], 6000, 5000, 4500, "br", "Liquid glass", "زجاج سائل"],
  ["monochrome_noir", "art", 35, 2.8, 3, [4, 3], 4000, 6500, 3200, "bl", "Monochrome noir", "نوار أحادي اللون"],
  ["paper_cutout_layers", "art", 50, 5.6, 2, [4, 3], 5000, 5600, 4300, "tr", "Paper cut-out layers", "طبقات ورق مقصوص"],
  ["wireframe_cad", "art", 200, 16, 10, [16, 9], 6500, 6500, 6500, "br", "Wireframe CAD", "إطار سلكي هندسي"],
].map(([id, category, focal_mm, f_stop, subject_m, aspect, key, fill, rim, spiral, en, ar]) => ({ id, category, focal_mm, f_stop, subject_m, aspect, kelvin: { key, fill, rim }, spiral, title: { en, ar } }));

const cpR = (v, d = 2) => { const p = 10 ** d, x = Math.round(v * p) / p; return Object.is(x, -0) ? 0 : x; };
const cpFail = (m, detail) => { throw new HyperError(m, detail); };

// The frame: 640 wide, as tall as the aspect ratio says.
export function frameOf(aspect) { return { w: 640, h: cpR(640 * aspect[1] / aspect[0]) }; }

// The largest golden rectangle inside the frame, centred: landscape when the frame is wider than φ, otherwise
// as wide as the frame.
export function goldenRect(w, h) {
  const gw = Math.min(w, h * PHI), gh = gw / PHI;
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
}

// A golden spiral of n quarter circles. Each step cuts a square from the rectangle that is left, on the left,
// top, right and bottom in turn, and draws a quarter circle across it; the next arc starts where the last one
// ended. Returns the arcs and the rectangle left after the last cut.
export function goldenSpiral(rect, n = 10) {
  let { x, y, w, h } = rect;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const side = i % 4;
    if (side === 0) { const s = h; arcs.push({ from: [x, y + s], to: [x + s, y], c: [x + s, y + s], r: s }); x += s; w -= s; }
    else if (side === 1) { const s = w; arcs.push({ from: [x, y], to: [x + s, y + s], c: [x, y + s], r: s }); y += s; h -= s; }
    else if (side === 2) { const s = h; arcs.push({ from: [x + w, y], to: [x + (w - s), y + s], c: [x + (w - s), y], r: s }); w -= s; }
    else { const s = w; arcs.push({ from: [x + w, y + h], to: [x, y + (h - s)], c: [x + w, y + (h - s)], r: s }); h -= s; }
  }
  return { arcs, rest: { x, y, w, h } };
}
// The eye of the spiral, where the subject goes: the crossing of the golden rectangle's diagonal from top left
// to bottom right with the diagonal from bottom left to top right of the rectangle left after the first cut.
export function spiralEye(rect) {
  const { x, y, w, h } = rect, a = [x, y], b = [x + w, y + h], c = [x + h, y + h], d = [x + w, y];
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// Mirror a point so the spiral closes in the preset's corner; the unmirrored spiral closes towards the right
// and the bottom of its rectangle ("br").
export function mirrorPoint(p, corner, w, h) { return [corner[1] === "l" ? w - p[0] : p[0], corner[0] === "t" ? h - p[1] : p[1]]; }

// The checks the composition passes: every arc starts exactly where the one before it ended (both come from
// the same corner of the same cut), each arc's ends are its radius from its centre within 2^-30 of the
// radius, every point is inside the frame within 2^-20 of a pixel, and the spiral closes on the eye: the
// rectangle left after the last cut lies within a hundredth of the golden rectangle's width of it.
export const CP_EPS = { radius: 2 ** -30, frame: 2 ** -20 };
export function arcsJoin(arcs) { return arcs.every((a, i) => i === 0 || (a.from[0] === arcs[i - 1].to[0] && a.from[1] === arcs[i - 1].to[1])); }
export function arcsRound(arcs) { return arcs.every(a => Math.abs(Math.hypot(a.from[0] - a.c[0], a.from[1] - a.c[1]) - a.r) <= CP_EPS.radius * a.r && Math.abs(Math.hypot(a.to[0] - a.c[0], a.to[1] - a.c[1]) - a.r) <= CP_EPS.radius * a.r); }
export function insideFrame(points, w, h) { return points.every(([x, y]) => x >= -CP_EPS.frame && x <= w + CP_EPS.frame && y >= -CP_EPS.frame && y <= h + CP_EPS.frame); }
export function closesOnEye(rest, eye, width) {
  return [[rest.x, rest.y], [rest.x + rest.w, rest.y + rest.h]].every(([x, y]) => Math.hypot(x - eye[0], y - eye[1]) <= width / 100);
}

export function composition(preset) {
  const { w, h } = frameOf(preset.aspect), g = goldenRect(w, h), sp = goldenSpiral(g), e0 = spiralEye(g);
  const m = p => mirrorPoint(p, preset.spiral, w, h);
  const arcs = sp.arcs.map(a => ({ from: m(a.from), to: m(a.to), c: m(a.c), r: a.r }));
  const eye = m(e0);
  const pts = arcs.flatMap(a => [a.from, a.to, a.c]).concat([eye]);
  const checks = [
    { text: "Each quarter circle of the spiral starts where the last one ended.", ok: arcsJoin(arcs) },
    { text: "Each arc's ends lie on its circle.", ok: arcsRound(arcs) },
    { text: "The spiral and the subject point stay inside the frame.", ok: insideFrame(pts, w, h) },
    { text: "The spiral closes on the subject point, where the golden rectangle's diagonals cross.", ok: closesOnEye(sp.rest, e0, g.w) },
  ];
  return { w, h, lines: { x: [cpR(w / PHI / PHI), cpR(w / PHI)], y: [cpR(h / PHI / PHI), cpR(h / PHI)] },
    arcs: arcs.map(a => ({ from: a.from.map(v => cpR(v)), to: a.to.map(v => cpR(v)), r: cpR(a.r), sweep: sweepOf(a) })), eye: eye.map(v => cpR(v)), checks };
}
// SVG's sweep flag for an arc: 1 when it turns clockwise on screen (y down) from its start to its end.
export function sweepOf(a) {
  const u = [a.from[0] - a.c[0], a.from[1] - a.c[1]], v = [a.to[0] - a.c[0], a.to[1] - a.c[1]];
  return u[0] * v[1] - u[1] * v[0] > 0 ? 1 : 0;
}

// The SVG: the frame, the four golden-section lines, the spiral, the subject point and, under the frame, the
// depth of field as a bar from 0 to twice the subject distance. Numbers only; no text.
export function cinematicSvg(c, dof, subject, theme) {
  const a = HS_ACCENT[theme === "light" ? "light" : "dark"], H = c.h + 40, scale = (c.w - 40) / (2 * subject);
  const near = 20 + Math.min(dof.near_m, 2 * subject) * scale, far = 20 + (dof.far_m == null ? 2 * subject : Math.min(dof.far_m, 2 * subject)) * scale;
  const d = "M" + c.arcs[0].from.join(" ") + c.arcs.map(x => ` A${x.r} ${x.r} 0 0 ${x.sweep} ${x.to.join(" ")}`).join("");
  const parts = [
    `<rect x="1" y="1" width="${c.w - 2}" height="${cpR(c.h - 2)}" fill="none" stroke="${a}" stroke-width="2"/>`,
    ...c.lines.x.map(x => `<line x1="${x}" y1="0" x2="${x}" y2="${c.h}" stroke="${a}" stroke-opacity="0.45" stroke-width="1"/>`),
    ...c.lines.y.map(y => `<line x1="0" y1="${y}" x2="${c.w}" y2="${y}" stroke="${a}" stroke-opacity="0.45" stroke-width="1"/>`),
    `<path d="${d}" fill="none" stroke="${a}" stroke-width="2"/>`,
    `<circle cx="${c.eye[0]}" cy="${c.eye[1]}" r="7" fill="${a}"/>`,
    `<line x1="20" y1="${cpR(c.h + 24)}" x2="${c.w - 20}" y2="${cpR(c.h + 24)}" stroke="${a}" stroke-opacity="0.45" stroke-width="2"/>`,
    `<rect x="${cpR(near)}" y="${cpR(c.h + 18)}" width="${cpR(Math.max(1, far - near))}" height="12" fill="${a}"/>`,
    `<line x1="${cpR(20 + subject * scale)}" y1="${cpR(c.h + 12)}" x2="${cpR(20 + subject * scale)}" y2="${cpR(c.h + 36)}" stroke="${a}" stroke-width="2"/>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.w} ${cpR(H)}" width="${c.w}" height="${cpR(H)}" role="img" aria-hidden="true">${parts.join("")}</svg>`;
}

// One preset compiled for a theme. subject_distance_m may move the subject; everything else is the preset's.
export function compileCinematic(req) {
  const r = req && typeof req === "object" ? req : {};
  const preset = CINEMATIC_PRESETS.find(p => p.id === r.preset);
  if (!preset) cpFail("Choose one of the cinematic presets.", typeof r.preset === "string" ? r.preset : "");
  const theme = r.theme === "light" ? "light" : "dark";
  const subject = r.subject_distance_m == null ? preset.subject_m : r.subject_distance_m;
  const o = optics({ focal_mm: preset.focal_mm, f_stop: preset.f_stop, subject_distance_m: subject, sensor_width_mm: 36,
    key_kelvin: preset.kelvin.key, fill_kelvin: preset.kelvin.fill, rim_kelvin: preset.kelvin.rim });
  const surface = CP_SURFACE[theme];
  const labels = {};
  for (const k of ["key", "fill", "rim"]) {
    const h = healOklchContrast(o.lights[k].hex, surface);
    labels[k] = { light: o.lights[k].hex, text: h.ok ? h.after.hex : null, healed: h.changed, wcag: h.ok ? h.after.ratio : null, apca: h.ok ? h.after.lc : null };
  }
  const c = composition(preset);
  const checks = [...o.checks, ...c.checks, { text: "Each light's colour, as text on the surface, passes WCAG 4.5 and APCA Lc 60 (healed where needed, hue kept).", ok: Object.values(labels).every(l => l.text !== null) }];
  const out = { preset: preset.id, category: preset.category, title: preset.title, tag: "[INFERENCE]", theme, accent: HS_ACCENT[theme], surface,
    aspect: preset.aspect, lens: o.lens, depth_of_field: o.depth_of_field, field_of_view_deg: o.field_of_view_deg, background_blur: o.background_blur,
    lights: o.lights, labels, composition: { w: c.w, h: c.h, lines: c.lines, eye: c.eye, arcs: c.arcs }, checks, verified: checks.every(x => x.ok) };
  out.svg = cinematicSvg(c, o.depth_of_field, subject, theme);
  return out;
}

export function presetList() { return CINEMATIC_PRESETS.map(p => ({ id: p.id, category: p.category, title: p.title, focal_mm: p.focal_mm, f_stop: p.f_stop, subject_m: p.subject_m, aspect: p.aspect, kelvin: p.kelvin })); }
