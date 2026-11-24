import io

from PIL import Image

from app.engines.stub import StubEngine
from app.pipeline import EMPTY, prepare, read_picture, sha256

ROWS = ["JazzCash", "Transaction Successful", "Amount", "Rs. 200", "Transaction ID", "TX-AAA-1111", "Date", "24 Nov 2026"]


def picture(fmt: str = "PNG", size=(800, 1600), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (240, 240, 240) if mode == "RGB" else (240, 240, 240, 255)).save(buf, fmt)
    return buf.getvalue()


def test_a_picture_is_read_and_hashed_as_received():
    data = picture()
    fields, digest = read_picture(data, StubEngine(ROWS))
    assert digest == sha256(data) and len(digest) == 64
    assert fields["amount"] == 200 and fields["transaction_id"] == "TX-AAA-1111" and fields["app"] == "jazzcash"


def test_a_file_that_is_not_a_picture_gives_empty_fields_not_an_error():
    fields, digest = read_picture(b"this is not an image", StubEngine(ROWS))
    assert fields == EMPTY
    assert digest == sha256(b"this is not an image")


def test_only_jpeg_png_and_webp_are_accepted():
    fields, _ = read_picture(picture("GIF"), StubEngine(ROWS))
    assert fields == EMPTY


def test_large_pictures_are_shrunk_small_ones_are_not_enlarged():
    big = prepare(picture(size=(3000, 6000)), 1600)
    assert max(big.size) == 1600 and big.size == (800, 1600)
    small = prepare(picture(size=(400, 700)), 1600)
    assert small.size == (400, 700)


def test_transparent_pictures_become_plain_rgb():
    img = prepare(picture(mode="RGBA", size=(100, 100)))
    assert img.mode == "RGB"


def test_an_engine_that_finds_nothing_gives_empty_fields():
    fields, _ = read_picture(picture(), StubEngine([]))
    assert fields == EMPTY
