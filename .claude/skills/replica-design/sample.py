#!/usr/bin/env python3
"""Measure colours from PNG screenshots. Standard library only, no network.

    python3 sample.py shot.png --top 12              # dominant colours, clustered
    python3 sample.py shot.png --at 120,48 640,300   # exact pixels (averaged 3x3)
    python3 sample.py a.png b.png --top 16 --json    # across several screens

--top merges colours closer than --merge (RGB distance, default 10) so
anti-aliasing does not show up as dozens of near-greys, and prints each
cluster's share of the sampled pixels with a guessed role hint (neutral vs
chromatic, light vs dark). You still assign the roles; this only measures.

Supports non-interlaced PNG, 8- or 16-bit, greyscale / RGB / palette, with or
without alpha (alpha is composited over white). Convert JPEGs to PNG first.
"""

import argparse
import json
import struct
import sys
import zlib

SIG = b"\x89PNG\r\n\x1a\n"
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != SIG:
        raise ValueError("%s: not a PNG" % path)
    pos, idat, palette, trns = 8, [], None, None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    if interlace:
        raise ValueError("%s: interlaced PNG not supported; re-save it" % path)
    if ctype not in CHANNELS or depth not in (8, 16) and not (ctype == 3 and depth == 8):
        raise ValueError("%s: unsupported PNG (type %d, depth %d)" % (path, ctype, depth))
    ch = CHANNELS[ctype]
    bpp = ch * depth // 8
    stride = w * bpp
    raw = zlib.decompress(b"".join(idat))
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    step = depth // 8

    def pixel(x, y):
        row = rows[y]
        o = x * bpp
        vals = [row[o + k * step] for k in range(ch)]  # high byte for 16-bit
        if ctype == 3:
            r, g, b = palette[vals[0]]
            alpha = trns[vals[0]] if trns and vals[0] < len(trns) else 255
        elif ctype in (0, 4):
            r = g = b = vals[0]
            alpha = vals[1] if ctype == 4 else 255
        else:
            r, g, b = vals[:3]
            alpha = vals[3] if ctype == 6 else 255
        if alpha < 255:
            k = alpha / 255.0
            r, g, b = (int(round(v * k + 255 * (1 - k))) for v in (r, g, b))
        return r, g, b

    return w, h, pixel


def hexc(rgb):
    return "#%02x%02x%02x" % tuple(rgb)


def hint(rgb):
    r, g, b = rgb
    light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    chroma = max(rgb) - min(rgb)
    tone = "light" if light > 0.6 else "dark" if light < 0.3 else "mid"
    return ("neutral-" if chroma < 18 else "chromatic-") + tone


def top_colours(images, n, merge, budget=250000):
    counts = {}
    total = 0
    for w, h, pixel in images:
        stride = max(1, int(((w * h) / budget) ** 0.5))
        for y in range(0, h, stride):
            for x in range(0, w, stride):
                r, g, b = pixel(x, y)
                key = (r >> 2, g >> 2, b >> 2)
                acc = counts.get(key)
                if acc is None:
                    counts[key] = [1, r, g, b]
                else:
                    acc[0] += 1
                    acc[1] += r
                    acc[2] += g
                    acc[3] += b
                total += 1
    clusters = []  # [rgb_sum, count, representative]
    for acc in sorted(counts.values(), key=lambda a: -a[0]):
        c = acc[0]
        rgb = [acc[1] / c, acc[2] / c, acc[3] / c]
        for cl in clusters:
            rep = cl[2]
            if sum((rgb[k] - rep[k]) ** 2 for k in range(3)) <= merge * merge:
                for k in range(3):
                    cl[0][k] += rgb[k] * c
                cl[1] += c
                break
        else:
            clusters.append([[rgb[k] * c for k in range(3)], c, rgb])
    out = []
    for s, c, _ in sorted(clusters, key=lambda cl: -cl[1])[:n]:
        rgb = [int(round(v / c)) for v in s]
        out.append({"hex": hexc(rgb), "share": round(100.0 * c / total, 2), "hint": hint(rgb)})
    return out


def at(img, points):
    w, h, pixel = img
    out = []
    for p in points:
        x, y = (int(v) for v in p.split(","))
        if not (0 <= x < w and 0 <= y < h):
            out.append({"at": p, "error": "outside %dx%d" % (w, h)})
            continue
        acc, n = [0, 0, 0], 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h:
                    px = pixel(xx, yy)
                    for k in range(3):
                        acc[k] += px[k]
                    n += 1
        rgb = [int(round(v / n)) for v in acc]
        out.append({"at": p, "hex": hexc(rgb), "exact": hexc(pixel(x, y)), "hint": hint(rgb)})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Measure colours from PNG screenshots")
    ap.add_argument("png", nargs="+")
    ap.add_argument("--top", type=int, default=0, help="list N dominant colour clusters")
    ap.add_argument("--merge", type=float, default=10.0, help="cluster radius in RGB units")
    ap.add_argument("--at", nargs="+", metavar="X,Y", help="sample points (first image)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        images = [read_png(p) for p in a.png]
    except (OSError, ValueError, zlib.error, struct.error) as exc:
        print("sample: %s" % exc, file=sys.stderr)
        return 2
    result = {"images": [{"file": f, "size": "%dx%d" % (im[0], im[1])} for f, im in zip(a.png, images)]}
    if a.top or not a.at:
        result["top"] = top_colours(images, a.top or 12, a.merge)
    if a.at:
        result["at"] = at(images[0], a.at)
    if a.json:
        print(json.dumps(result, indent=2))
        return 0
    for im in result["images"]:
        print("  %s  %s" % (im["file"], im["size"]))
    if "top" in result:
        print("\n  dominant colours")
        for c in result["top"]:
            print("  %s  %6.2f%%  %s" % (c["hex"], c["share"], c["hint"]))
    if "at" in result:
        print("\n  sampled points (3x3 mean, exact pixel)")
        for c in result["at"]:
            if "error" in c:
                print("  %-10s %s" % (c["at"], c["error"]))
            else:
                print("  %-10s %s  (%s)  %s" % (c["at"], c["hex"], c["exact"], c["hint"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
