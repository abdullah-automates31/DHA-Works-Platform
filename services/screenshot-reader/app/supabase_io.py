"""The three things the service does against Supabase, all with the service-role key (kept only in this server's environment):
ask where a payment's screenshot is, download it, and hand over what was read. The database applies the rules."""
from __future__ import annotations

import httpx

from .config import Settings


class Io:
    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._s = settings
        self._c = client or httpx.Client(timeout=30.0)

    def _headers(self) -> dict[str, str]:
        return {"apikey": self._s.service_key, "Authorization": f"Bearer {self._s.service_key}"}

    def _rpc(self, name: str, body: dict[str, object]) -> object:
        r = self._c.post(f"{self._s.supabase_url}/rest/v1/rpc/{name}", json=body, headers={**self._headers(), "Content-Type": "application/json"})
        r.raise_for_status()
        return r.json() if r.content else None

    def context(self, payment_id: str) -> dict[str, object]:
        out = self._rpc("dues_check_context", {"p_payment": payment_id})
        return out if isinstance(out, dict) else {}

    def download(self, proof_path: str) -> bytes:
        r = self._c.get(f"{self._s.supabase_url}/storage/v1/object/{self._s.bucket}/{proof_path}", headers=self._headers())
        r.raise_for_status()
        if len(r.content) > self._s.max_image_bytes:
            raise ValueError("screenshot is larger than allowed")
        return r.content

    def apply(self, payment_id: str, extracted: dict[str, object], sha: str | None, engine: str) -> object:
        return self._rpc("dues_check_apply", {"p_payment": payment_id, "p_extracted": extracted, "p_sha": sha, "p_engine": engine})
