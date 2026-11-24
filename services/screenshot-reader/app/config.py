"""Settings come from the environment (the server's .env, never the repository). Nothing here is printed or logged."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str
    webhook_secret: str
    engine: str = "paddle"          # "paddle" or "stub"
    max_concurrency: int = 2
    max_image_bytes: int = 5 * 1024 * 1024   # the dues-proof bucket allows 5 MB
    max_side_px: int = 1600
    bucket: str = "dues-proof"

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "READER_WEBHOOK_SECRET") if not e.get(k)]
        if missing:
            raise RuntimeError("missing settings: " + ", ".join(missing))
        secret = e["READER_WEBHOOK_SECRET"]
        if len(secret) < 16:
            raise RuntimeError("READER_WEBHOOK_SECRET must be at least 16 characters")
        return Settings(
            supabase_url=e["SUPABASE_URL"].rstrip("/"),
            service_key=e["SUPABASE_SERVICE_ROLE_KEY"],
            webhook_secret=secret,
            engine=e.get("READER_ENGINE", "paddle"),
            max_concurrency=max(1, int(e.get("READER_MAX_CONCURRENCY", "2"))),
        )
