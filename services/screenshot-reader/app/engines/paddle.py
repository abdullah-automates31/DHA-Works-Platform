"""PaddleOCR (open source, runs on our own server, CPU only). The image never leaves this machine.

NOT YET RUN: PaddleOCR is installed only on the server (see README), so this file is checked by unit tests on the shape of its answers
(normalise()), not against the real library. PaddleOCR 2.x returns [[box, (text, score)], ...] per image; 3.x returns result objects with
rec_texts / rec_scores / rec_polys. Both are handled. Pin the version in requirements.txt and run the accuracy set before trusting it.
"""
from __future__ import annotations

from typing import Any

from PIL import Image

from .base import OcrLine


def _line(box: Any, text: Any, score: Any) -> OcrLine | None:
    """One box (four corner points, or [x1, y1, x2, y2]) and its text become an OcrLine; anything malformed is skipped."""
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        pts = [(float(p[0]), float(p[1])) for p in box] if box and isinstance(box[0], (list, tuple)) else None
        if pts is None:
            x1, y1, x2, y2 = (float(v) for v in box)
            pts = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return OcrLine(text=text.strip(), x=min(xs), y=(min(ys) + max(ys)) / 2, h=max(ys) - min(ys), conf=float(score) if score is not None else 1.0)
    except (TypeError, ValueError, IndexError):
        return None


def normalise(raw: Any) -> list[OcrLine]:
    """Turn what PaddleOCR answered (either generation) into OcrLines."""
    lines: list[OcrLine] = []
    if raw is None:
        return lines
    for page in raw:
        if page is None:
            continue
        # 3.x: a dict-like result with parallel lists
        get = page.get if hasattr(page, "get") else None
        if get is not None and get("rec_texts") is not None:
            texts = get("rec_texts") or []
            scores = get("rec_scores") or [None] * len(texts)
            boxes = get("rec_polys")
            if boxes is None:
                boxes = get("rec_boxes")
            boxes = boxes if boxes is not None else [None] * len(texts)
            for box, text, score in zip(boxes, texts, scores):
                ln = _line(box.tolist() if hasattr(box, "tolist") else box, text, score)
                if ln:
                    lines.append(ln)
            continue
        # 2.x: a list of [box, (text, score)]
        for item in page:
            try:
                box, (text, score) = item
            except (TypeError, ValueError):
                continue
            ln = _line(box, text, score)
            if ln:
                lines.append(ln)
    return lines


class PaddleEngine:
    name = "paddleocr"

    def __init__(self) -> None:
        from paddleocr import PaddleOCR  # imported here so the tests and the stub never need it

        try:
            self._ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)  # 2.x
        except (TypeError, ValueError):
            self._ocr = PaddleOCR(use_textline_orientation=True, lang="en")  # 3.x

    def read(self, image: Image.Image) -> list[OcrLine]:
        import numpy as np

        arr = np.array(image.convert("RGB"))
        try:
            raw = self._ocr.ocr(arr, cls=True)  # 2.x
        except TypeError:
            raw = self._ocr.predict(arr)  # 3.x
        return normalise(raw)
