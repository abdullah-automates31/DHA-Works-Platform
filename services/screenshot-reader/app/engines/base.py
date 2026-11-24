"""The reader interface: an image goes in, lines of text with their place on the picture come out.

Everything after this point (rows, parsers, the database rules) works on plain text, so the OCR engine behind this interface can be
swapped (PaddleOCR today) without touching a parser or a rule. An engine only READS; it never decides anything.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from PIL import Image


@dataclass(frozen=True)
class OcrLine:
    text: str
    x: float  # left edge, in pixels of the image that was read
    y: float  # vertical centre
    h: float  # height of the box
    conf: float = 1.0


class Engine(Protocol):
    name: str

    def read(self, image: Image.Image) -> list[OcrLine]: ...


def lines_to_rows(lines: list[OcrLine]) -> list[str]:
    """Group boxes that sit on the same visual row into one string, top to bottom, left to right.

    Payment screens put a label on the left and its value on the right of the same row; the parsers want "Label   value" as one string.
    Two boxes are on the same row when their vertical centres are closer than 60% of the typical box height.
    """
    usable = [ln for ln in lines if ln.text.strip()]
    if not usable:
        return []
    heights = sorted(ln.h for ln in usable if ln.h > 0)
    typical = heights[len(heights) // 2] if heights else 12.0
    tolerance = max(typical * 0.6, 4.0)
    ordered = sorted(usable, key=lambda ln: (ln.y, ln.x))
    rows: list[list[OcrLine]] = []
    for ln in ordered:
        if rows and abs(ln.y - (sum(r.y for r in rows[-1]) / len(rows[-1]))) <= tolerance:
            rows[-1].append(ln)
        else:
            rows.append([ln])
    return ["  ".join(part.text.strip() for part in sorted(row, key=lambda ln: ln.x)) for row in rows]
