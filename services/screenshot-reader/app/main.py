"""DHA's own screenshot reader. The database calls POST /check with a payment id; this service reads the screenshot on this machine and
hands the fixed fields back to the database, which applies the rules. Nothing is sent to any other company.

Run (on the server): uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1
"""
from __future__ import annotations

import hmac
import logging
import threading
from typing import Callable
from uuid import UUID

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .config import Settings
from .engines.base import Engine
from .pipeline import EMPTY, read_picture
from .supabase_io import Io

log = logging.getLogger("reader")


class CheckIn(BaseModel):
    payment_id: UUID


def run_check(payment_id: str, io: Io, engine: Engine, slots: threading.Semaphore, max_side: int) -> str:
    """One payment. Returns what happened (for the logs and the tests): 'applied', 'skipped' or 'unreachable'.

    A failure to REACH Supabase writes nothing, so the 5-minute retry job asks again. A picture that cannot be read still writes (empty
    fields, "could not read"), so a bad file is not retried for an hour.
    """
    with slots:
        try:
            ctx = io.context(payment_id)
            proof = ctx.get("proof_path")
            if not ctx.get("pending") or not isinstance(proof, str):
                return "skipped"
            data = io.download(proof)
        except Exception:  # network, storage or the database: nothing written, the retry job will ask again
            log.warning("check %s: could not fetch the screenshot", payment_id)
            return "unreachable"
        try:
            extracted, digest = read_picture(data, engine, max_side)
        except Exception:  # an engine failure on this picture: say "could not read" rather than loop
            log.warning("check %s: the reader failed on this picture", payment_id)
            extracted, digest = dict(EMPTY), None
        try:
            io.apply(payment_id, extracted, digest, engine.name)
        except Exception:
            log.warning("check %s: could not hand the reading to the database", payment_id)
            return "unreachable"
        log.info("check %s: done", payment_id)  # ids and counts only: never what was read
        return "applied"


def create_app(settings: Settings, io: Io, engine: Engine, runner: Callable[..., str] = run_check) -> FastAPI:
    app = FastAPI(title="DHA screenshot reader", docs_url=None, redoc_url=None, openapi_url=None)
    slots = threading.Semaphore(settings.max_concurrency)

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"ok": True, "engine": engine.name}

    @app.post("/check", status_code=202)
    def check(body: CheckIn, background: BackgroundTasks, x_reader_secret: str | None = Header(default=None)) -> dict[str, bool]:
        if not hmac.compare_digest((x_reader_secret or "").encode(), settings.webhook_secret.encode()):
            raise HTTPException(status_code=401, detail="not allowed")
        # answer at once: reading can take longer than the database is willing to wait for a reply
        background.add_task(runner, str(body.payment_id), io, engine, slots, settings.max_side_px)
        return {"accepted": True}

    return app


def build() -> FastAPI:
    settings = Settings.from_env()
    if settings.engine == "stub":
        from .engines.stub import StubEngine

        engine: Engine = StubEngine()
    else:
        from .engines.paddle import PaddleEngine

        engine = PaddleEngine()
    return create_app(settings, Io(settings), engine)


def __getattr__(name: str):  # `uvicorn app.main:app` builds the real app lazily; importing this module in a test builds nothing
    if name == "app":
        return build()
    raise AttributeError(name)
