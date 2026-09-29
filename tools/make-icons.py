#!/usr/bin/env python3
"""Draw Vifari's icons.

Kept as a script rather than as eight binaries someone has to open an image
editor to change: the mark is a handful of numbers, and this way moving a
stroke is a diff you can read.

Written straight out as PNG rather than through an imaging library, so that
regenerating them needs nothing that isn't already on the machine.
"""

import struct
import zlib
from pathlib import Path

# Safari's converter asks for the small sizes for the toolbar and the large
# ones for the app icon it builds the Xcode project around. Giving it all of
# them means it never has to scale one itself.
SIZES = [16, 32, 48, 64, 96, 128, 256, 512]

BACKGROUND = (0x1D, 0x21, 0x29)   # slate, so the mark reads on light and dark
STROKE = (0x8E, 0xC0, 0x7C)       # vim green

# The V, as two strokes in a unit square, and how thick they are drawn.
STROKES = [((0.28, 0.26), (0.5, 0.72)), ((0.72, 0.26), (0.5, 0.72))]
THICKNESS = 0.155
CORNER = 0.22                     # rounded-square background, iOS-ish

# Each pixel is sampled this many times across, then averaged. Cheap
# anti-aliasing, and at these sizes the whole thing still runs instantly.
SAMPLES = 4


def near_segment(px, py, a, b, reach):
    """Whether a point is within reach of a segment, caps included."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy

    t = 0.0 if length == 0 else ((px - ax) * dx + (py - ay) * dy) / length
    t = max(0.0, min(1.0, t))

    cx, cy = ax + t * dx, ay + t * dy
    return (px - cx) ** 2 + (py - cy) ** 2 <= reach * reach


def inside_rounded_square(px, py, radius):
    """Whether a point is inside a rounded unit square.

    Measured from an inner square inset by the radius: how far the point lies
    outside that square, in each direction and never less than zero, and then
    whether those two together are within the radius. Clamping at zero is what
    makes it a rounded rectangle rather than a rounded diamond -- along an edge
    only one direction is outside, so the other contributes nothing and the
    edge stays straight until the corner.
    """
    qx = max(abs(px - 0.5) - (0.5 - radius), 0.0)
    qy = max(abs(py - 0.5) - (0.5 - radius), 0.0)
    return qx * qx + qy * qy <= radius * radius


def render(size):
    """One icon, as RGBA rows."""
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    px = (x + (sx + 0.5) / SAMPLES) / size
                    py = (y + (sy + 0.5) / SAMPLES) / size

                    if not inside_rounded_square(px, py, CORNER):
                        continue
                    on_stroke = any(
                        near_segment(px, py, p, q, THICKNESS / 2)
                        for p, q in STROKES
                    )
                    colour = STROKE if on_stroke else BACKGROUND
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += 255

            taken = SAMPLES * SAMPLES
            # Averaged over every sample, not just the ones that landed inside,
            # so the edge fades out instead of ending abruptly.
            row += bytes((r // taken, g // taken, b // taken, a // taken))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        # 8 bits per channel, colour type 6: RGBA.
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    out = Path(__file__).resolve().parent.parent / "extension" / "images"
    out.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        path = out / f"icon-{size}.png"
        write_png(path, size, render(size))
        print(f"{path.relative_to(out.parent.parent)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
