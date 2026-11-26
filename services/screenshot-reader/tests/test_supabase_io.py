"""The real Io class against a mock HTTP transport (no network): what it sends, and that an oversized file is refused."""
import json

import httpx
import pytest

from app.config import Settings
from app.supabase_io import Io

SETTINGS = Settings(supabase_url="https://example.supabase.co", service_key="k" * 40, webhook_secret="s" * 20, max_image_bytes=1000)


def io_with(handler) -> Io:
    return Io(SETTINGS, httpx.Client(transport=httpx.MockTransport(handler)))


def test_download_returns_the_file_and_uses_the_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, content=b"x" * 500)

    data = io_with(handler).download("uid/dues/pic.jpg")
    assert data == b"x" * 500
    assert seen["url"] == "https://example.supabase.co/storage/v1/object/dues-proof/uid/dues/pic.jpg"
    assert seen["auth"] == "Bearer " + "k" * 40


def test_download_refuses_a_file_over_the_limit_by_its_declared_size():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 10, headers={"content-length": "5000"})

    with pytest.raises(ValueError):
        io_with(handler).download("uid/dues/pic.jpg")


def test_download_refuses_a_file_over_the_limit_when_no_size_is_declared():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 5000)

    with pytest.raises(ValueError):
        io_with(handler).download("uid/dues/pic.jpg")


def test_download_error_status_raises():
    with pytest.raises(httpx.HTTPStatusError):
        io_with(lambda request: httpx.Response(404)).download("uid/dues/missing.jpg")


def test_apply_sends_the_four_fields_to_the_database_function():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"verdict": "matches"})

    out = io_with(handler).apply("pid", {"amount": 50}, "abc", "paddleocr")
    assert seen["path"] == "/rest/v1/rpc/dues_check_apply"
    assert seen["body"] == {"p_payment": "pid", "p_extracted": {"amount": 50}, "p_sha": "abc", "p_engine": "paddleocr"}
    assert out == {"verdict": "matches"}


def test_context_that_is_not_an_object_becomes_empty():
    assert io_with(lambda request: httpx.Response(200, json=None)).context("pid") == {}
