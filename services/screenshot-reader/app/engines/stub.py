"""A reader that returns fixed text. Used by the tests and by a first deploy before the real engine is installed."""
from __future__ import annotations

from PIL import Image

from .base import OcrLine


class StubEngine:
    name = "stub"

    def __init__(self, rows: list[str] | None = None) -> None:
        self._rows = rows or []

    def read(self, image: Image.Image) -> list[OcrLine]:
        return [OcrLine(text=row, x=0.0, y=float(i * 30), h=20.0) for i, row in enumerate(self._rows)]
