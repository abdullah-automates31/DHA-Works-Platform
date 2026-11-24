import io
import threading

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.engines.stub import StubEngine
from app.main import create_app, run_check
from app.pipeline import EMPTY

SECRET = "x" * 24
PAYMENT = "00000000-0000-0000-0000-0000000000d1"
ROWS = ["JazzCash", "Transaction Successful", "Amount", "Rs. 200", "Transaction ID", "TX-AAA-1111"]


def settings() -> Settings:
    return Settings(supabase_url="https://example.invalid", service_key="k", webhook_secret=SECRET)


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (200, 400), (250, 250, 250)).save(buf, "PNG")
    return buf.getvalue()


class FakeIo:
    def __init__(self, ctx=None, data=None, fail_download=False, fail_apply=False):
        self.ctx = {"proof_path": "w/dues/d1.png", "pending": True, "checked": False} if ctx is None else ctx
        self.data = png() if data is None else data
        self.fail_download, self.fail_apply = fail_download, fail_apply
        self.applied: list[tuple] = []

    def context(self, payment_id):
        return self.ctx

    def download(self, path):
        if self.fail_download:
            raise RuntimeError("down")
        return self.data

    def apply(self, payment_id, extracted, sha, engine):
        if self.fail_apply:
            raise RuntimeError("down")
        self.applied.append((payment_id, extracted, sha, engine))


def slots():
    return threading.Semaphore(1)


def test_a_payment_is_read_and_handed_over():
    io_ = FakeIo()
    assert run_check(PAYMENT, io_, StubEngine(ROWS), slots(), 1600) == "applied"
    pid, extracted, sha, engine = io_.applied[0]
    assert pid == PAYMENT and engine == "stub" and len(sha) == 64
    assert extracted["amount"] == 200 and extracted["transaction_id"] == "TX-AAA-1111"


def test_a_payment_already_decided_or_without_a_screenshot_is_skipped():
    for ctx in ({"proof_path": "w/dues/d1.png", "pending": False}, {"proof_path": None, "pending": True}):
        io_ = FakeIo(ctx=ctx)
        assert run_check(PAYMENT, io_, StubEngine(ROWS), slots(), 1600) == "skipped"
        assert io_.applied == []


def test_when_the_screenshot_cannot_be_fetched_nothing_is_written_so_the_retry_asks_again():
    io_ = FakeIo(fail_download=True)
    assert run_check(PAYMENT, io_, StubEngine(ROWS), slots(), 1600) == "unreachable"
    assert io_.applied == []


def test_when_the_database_cannot_be_reached_it_says_so():
    assert run_check(PAYMENT, FakeIo(fail_apply=True), StubEngine(ROWS), slots(), 1600) == "unreachable"


def test_a_picture_that_cannot_be_read_still_writes_empty_fields_so_it_is_not_retried_for_an_hour():
    io_ = FakeIo(data=b"not a picture")
    assert run_check(PAYMENT, io_, StubEngine(ROWS), slots(), 1600) == "applied"
    assert io_.applied[0][1] == EMPTY


class Boom:
    name = "boom"

    def read(self, image):
        raise RuntimeError("engine crashed")


def test_an_engine_that_crashes_on_a_picture_writes_empty_fields_too():
    io_ = FakeIo()
    assert run_check(PAYMENT, io_, Boom(), slots(), 1600) == "applied"
    assert io_.applied[0][1] == EMPTY and io_.applied[0][2] is None


def client(calls: list) -> TestClient:
    def runner(payment_id, io_, engine, sl, max_side):
        calls.append(payment_id)
        return "applied"

    return TestClient(create_app(settings(), FakeIo(), StubEngine(ROWS), runner))


def test_health_needs_no_secret_and_names_the_engine():
    r = client([]).get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "engine": "stub"}


@pytest.mark.parametrize("headers", [{}, {"x-reader-secret": "wrong"}, {"x-reader-secret": ""}, {"x-reader-secret": SECRET + "x"}])
def test_a_call_without_the_right_secret_is_refused_and_starts_nothing(headers):
    calls: list = []
    r = client(calls).post("/check", json={"payment_id": PAYMENT}, headers=headers)
    assert r.status_code == 401
    assert calls == []


def test_the_right_secret_is_accepted_at_once_and_the_work_starts():
    calls: list = []
    r = client(calls).post("/check", json={"payment_id": PAYMENT}, headers={"x-reader-secret": SECRET})
    assert r.status_code == 202 and r.json() == {"accepted": True}
    assert calls == [PAYMENT]


@pytest.mark.parametrize("body", [{}, {"payment_id": "not-a-uuid"}, {"payment_id": 5}])
def test_a_bad_body_is_refused(body):
    calls: list = []
    r = client(calls).post("/check", json=body, headers={"x-reader-secret": SECRET})
    assert r.status_code == 422
    assert calls == []


def test_the_api_documentation_pages_are_off():
    c = client([])
    assert c.get("/docs").status_code == 404 and c.get("/openapi.json").status_code == 404


def test_settings_need_the_three_secrets_and_a_long_enough_one():
    good = {"SUPABASE_URL": "https://x.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "k", "READER_WEBHOOK_SECRET": "s" * 16}
    s = Settings.from_env(good)
    assert s.supabase_url == "https://x.supabase.co" and s.engine == "paddle"
    for missing in good:
        with pytest.raises(RuntimeError):
            Settings.from_env({k: v for k, v in good.items() if k != missing})
    with pytest.raises(RuntimeError):
        Settings.from_env({**good, "READER_WEBHOOK_SECRET": "short"})
