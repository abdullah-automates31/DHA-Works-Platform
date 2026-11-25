"""Image bytes in, the fixed fields out. The picture is hashed as it was received, then made ready for OCR and read; no verdict is made here."""
from __future__ import annotations

import hashlib
import io

from PIL import Image, ImageOps, UnidentifiedImageError

from .engines.base import Engine, lines_to_rows
from .parsers.extract import extract

EMPTY: dict[str, object] = {"app": None, "amount": None, "transaction_id": None, "paid_at": None, "receiver_name": None, "receiver_account": None, "status": None}
_ALLOWED = {"JPEG", "PNG", "WEBP"}


class BadImage(Exception):
    """The file is not a picture we accept (not JPEG, PNG or WebP, or too big to be a screenshot)."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare(data: bytes, max_side: int = 1200) -> Image.Image:
    """Open, honour the phone's rotation flag, drop any alpha, and shrink so the long side is at most max_side (never enlarge)."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in _ALLOWED:
            raise BadImage(f"unsupported format {img.format}")
        if img.width * img.height > 40_000_000:
            raise BadImage("picture is too large")
        img = ImageOps.exif_transpose(img)
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise BadImage("not a readable picture") from exc
    if img.mode != "RGB":
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = background
    longest = max(img.size)
    if longest > max_side:
        scale = max_side / longest
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    return img


def read_picture(data: bytes, engine: Engine, max_side: int = 1200) -> tuple[dict[str, object], str]:
    """(fields, sha256 of the original bytes). A picture that cannot be opened gives empty fields: the database then says "could not read"."""
    digest = sha256(data)
    try:
        img = prepare(data, max_side)
    except BadImage:
        return dict(EMPTY), digest
    rows = lines_to_rows(engine.read(img))
    return extract(rows), digest
