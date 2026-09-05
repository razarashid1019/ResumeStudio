#!/usr/bin/env python3
"""Generate AppIcon.png: a 1024x1024 macOS-squircle icon, no external image libs.

Blue->teal gradient (matches the in-app sidebar brand mark) inside a squircle,
with a simple white document + folded-corner + text-lines glyph on top.
"""
import struct
import zlib
from pathlib import Path

W = H = 1024

def lerp(a, b, t):
    return a + (b - a) * t

def gradient(x, y):
    # diagonal gradient, top-left teal -> bottom-right blue (brand-mark colors)
    t = (x / W + y / H) / 2
    c0 = (0x34, 0xC9, 0xEB)
    c1 = (0x00, 0x5F, 0xC9)
    return tuple(int(lerp(c0[i], c1[i], t)) for i in range(3))

def in_squircle(x, y, w, h, r):
    if r * 2 > min(w, h):
        r = min(w, h) / 2
    if x < r and y < r:
        return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > w - r and y < r:
        return (x - (w - r)) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > h - r:
        return (x - r) ** 2 + (y - (h - r)) ** 2 <= r * r
    if x > w - r and y > h - r:
        return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r
    return 0 <= x <= w and 0 <= y <= h

def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if x < x0 + r and y < y0 + r:
        return (x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x > x1 - r and y < y0 + r:
        return (x - (x1 - r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x < x0 + r and y > y1 - r:
        return (x - (x0 + r)) ** 2 + (y - (y1 - r)) ** 2 <= r * r
    if x > x1 - r and y > y1 - r:
        return (x - (x1 - r)) ** 2 + (y - (y1 - r)) ** 2 <= r * r
    return True

def build_pixels():
    corner_r = W * 0.225
    doc_x0, doc_y0, doc_x1, doc_y1 = W * 0.30, H * 0.19, W * 0.685, H * 0.81
    fold = W * 0.09
    line_color = (0x0A, 0x5B, 0xB8)
    rows = []
    for y in range(H):
        row = bytearray()
        for x in range(W):
            if not in_squircle(x + 0.5, y + 0.5, W, H, corner_r):
                row += b"\x00\x00\x00\x00"
                continue
            r, g, b = gradient(x, y)
            a = 255
            fx, fy = x + 0.5, y + 0.5
            if in_rounded_rect(fx, fy, doc_x0, doc_y0, doc_x1, doc_y1, W * 0.035):
                r, g, b = 255, 255, 255
                # folded corner (top-right dog-ear)
                cx, cy = doc_x1, doc_y0
                if fx > cx - fold and fy < cy + fold and (cx - fx) + (fy - cy) < fold:
                    r, g, b = 0xC9, 0xE3, 0xF5
                else:
                    # text lines
                    line_h = H * 0.028
                    margin = doc_x1 - doc_x0
                    lx0, lx1 = doc_x0 + margin * 0.16, doc_x1 - margin * 0.16
                    for i, ly in enumerate([0.36, 0.48, 0.60, 0.72]):
                        cy2 = doc_y0 + (doc_y1 - doc_y0) * ly
                        width_frac = 0.62 if i == 3 else 1.0
                        lx1b = lx0 + (lx1 - lx0) * width_frac
                        if lx0 <= fx <= lx1b and cy2 - line_h / 2 <= fy <= cy2 + line_h / 2:
                            r, g, b = line_color
            row += bytes((r, g, b, a))
        rows.append(bytes(row))
    return rows

def write_png(path, rows):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rows)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)

if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "AppIcon.png"
    write_png(out, build_pixels())
    print(f"wrote {out}")
