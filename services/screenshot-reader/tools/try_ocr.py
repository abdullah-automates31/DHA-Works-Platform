"""Runs the real OCR engine on the pictures in fixtures/synthetic (or fixtures/real) and compares with the .json next to each.

    .venv\\Scripts\\python tools\\try_ocr.py [folder] [--rows]
Needs the engine installed (requirements-engine.txt). Pictures never leave this computer.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.engines.paddle import PaddleEngine  # noqa: E402
from app.pipeline import read_picture  # noqa: E402

CHECK = ("app", "amount", "transaction_id", "receiver_name", "status")


def same(expected: object, got: object) -> bool:
    if isinstance(expected, str) and isinstance(got, str):
        return expected.upper().replace(" ", "") == got.upper().replace(" ", "")
    if isinstance(expected, (int, float)) and isinstance(got, (int, float)):
        return float(expected) == float(got)
    return expected == got


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_rows = "--rows" in sys.argv
    folder = Path(args[0]) if args else ROOT / "fixtures" / "synthetic"
    t0 = time.time()
    engine = PaddleEngine()
    print(f"engine ready in {time.time() - t0:.1f}s")
    ok = total = 0
    for png in sorted(folder.glob("*.png")):
        spec = png.with_suffix(".json")
        expected = json.loads(spec.read_text(encoding="utf-8")) if spec.exists() else {}
        t1 = time.time()
        fields, _sha = read_picture(png.read_bytes(), engine)
        secs = time.time() - t1
        print(f"\n== {png.name}  ({secs:.1f}s)")
        if show_rows:
            from PIL import Image

            for ln in engine.read(Image.open(png)):
                print(f"   row y={ln.y:6.0f} conf={ln.conf:.2f}  {ln.text}")
        print("   read:", {k: v for k, v in fields.items()})
        for k in CHECK:
            if k in expected:
                total += 1
                good = same(expected[k], fields.get(k))
                ok += good
                print(f"   {'ok  ' if good else 'FAIL'} {k}: expected {expected[k]!r}, got {fields.get(k)!r}")
    print(f"\n{ok} of {total} checked fields correct")


if __name__ == "__main__":
    main()
