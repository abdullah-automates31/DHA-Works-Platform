"""PaddleOCR (open source, runs on our own server, CPU only). The image never leaves this machine.

RUN AND MEASURED 25 Nov 2026 (paddlepaddle 3.3.1, paddleocr 3.7.0, CPU, Windows): reads fake screenshots correctly in about 5 s each. Unit tests check the shape of its answers
(normalise()), not against the real library. PaddleOCR 2.x returns [[box, (text, score)], ...] per image; 3.x returns result objects with
rec_texts / rec_scores / rec_polys. Both are handled. Pin the version in requirements.txt and run the accuracy set before trusting it.
"""
from __future__ import annotations

import os
import threading
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
        import paddleocr  # imported here so the tests and the stub never need it
        from paddleocr import PaddleOCR

        self._lock = threading.Lock()
        self._v3 = int(str(getattr(paddleocr, "__version__", "3")).split(".")[0]) >= 3
        if self._v3:
            # 3.x. A phone screenshot is flat and upright, so the document-photo steps (rotation and un-warping) are switched off:
            # faster, and less to go wrong. oneDNN is off because it crashes the 3.x CPU runtime on Windows
            # ("ConvertPirAttribute2RuntimeAttribute not support", tested 25 Nov 2026 with paddlepaddle 3.3.1 / paddleocr 3.7.0).
            # The "small" PP-OCRv6 models read a 1000 px screenshot in about 5 s on a plain CPU with the same text right as the "medium"
            # ones (about 30 s), measured 25 Nov 2026 on fake screenshots. READER_OCR_SIZE=medium switches back if real ones read worse.
            size = os.environ.get("READER_OCR_SIZE", "small")
            self._ocr = PaddleOCR(
                text_detection_model_name=f"PP-OCRv6_{size}_det",
                text_recognition_model_name=f"PP-OCRv6_{size}_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                enable_mkldnn=False,
            )
        else:
            self._ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)  # 2.x

    def read(self, image: Image.Image) -> list[OcrLine]:
        import numpy as np

        arr = np.array(image.convert("RGB"))
        # One PaddleOCR object is shared by every request. It is not documented as safe for two reads at once, and on a CPU two
        # parallel reads would not be faster anyway, so reads take turns.
        with self._lock:
            raw = self._ocr.predict(arr) if self._v3 else self._ocr.ocr(arr, cls=True)
        return normalise(raw)
