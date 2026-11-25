"""Makes FAKE payment screenshots (made-up names, numbers and amounts, no real data) to test the reader on this PC.

Each picture gets a matching .json with what a correct reader should return. Run from services/screenshot-reader:
    .venv\\Scripts\\python tools\\make_fake_screens.py
The pictures only imitate the *kind* of layout (a label with its value beside it or below it); they are not copies of any real app.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "fixtures" / "synthetic"
FONT_DIR = Path("C:/Windows/Fonts")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "segoeui.ttf", "calibri.ttf"):
        p = FONT_DIR / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def render(name: str, app_title: str, headline: str, rows: list[tuple[str, str]], layout: str, accent: tuple[int, int, int], expected: dict) -> None:
    w, h = 1080, 2100
    img = Image.new("RGB", (w, h), (246, 247, 249))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 260], fill=accent)
    d.text((60, 100), app_title, font=font(64, True), fill=(255, 255, 255))
    d.ellipse([w // 2 - 90, 330, w // 2 + 90, 510], fill=accent)
    d.text((w // 2 - 40, 380), "OK", font=font(64, True), fill=(255, 255, 255))
    d.text((w // 2 - d.textlength(headline, font=font(54, True)) // 2, 560), headline, font=font(54, True), fill=(20, 30, 25))
    y = 760
    for label, value in rows:
        if layout == "side":
            d.text((70, y), label, font=font(42), fill=(110, 118, 125))
            d.text((w - 70 - d.textlength(value, font=font(44, True)), y), value, font=font(44, True), fill=(20, 30, 25))
            y += 120
        else:  # stacked: the label above its value
            d.text((70, y), label, font=font(38), fill=(110, 118, 125))
            d.text((70, y + 56), value, font=font(48, True), fill=(20, 30, 25))
            y += 190
        d.line([70, y - 28, w - 70, y - 28], fill=(225, 228, 232), width=2)
    img.save(OUT / f"{name}.png")
    (OUT / f"{name}.json").write_text(json.dumps(expected, indent=2), encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(
        "jazzcash_ok", "JazzCash", "Transaction Successful",
        [("Amount", "Rs. 50.00"), ("Transaction ID", "123456789012"), ("Sent to", "DHA WORKS"), ("Account Number", "0300 *****67"), ("Date & Time", "24 Nov 2026 03:45 PM"), ("Fee", "Rs. 0.00")],
        "side", (214, 31, 40),
        {"app": "jazzcash", "amount": 50, "transaction_id": "123456789012", "receiver_name": "DHA WORKS", "status": "success"},
    )
    render(
        "easypaisa_ok", "easypaisa", "Payment Successful",
        [("Amount Sent", "Rs 1,250.00"), ("Transaction ID", "98765432101"), ("Receiver Name", "DHA WORKS"), ("Mobile Number", "03XX XXXX567"), ("Date and Time", "23 Nov 2026 11:20 AM")],
        "stacked", (0, 168, 94),
        {"app": "easypaisa", "amount": 1250, "transaction_id": "98765432101", "receiver_name": "DHA WORKS", "status": "success"},
    )
    render(
        "bank_ok", "Demo Bank - Raast", "Funds Transfer Successful",
        [("Amount", "PKR 60"), ("Reference Number", "RAAST20261124778899"), ("Beneficiary Name", "DHA WORKS"), ("Beneficiary Account", "PK36XXXX0000001234567890"), ("Date", "24-11-2026 16:02")],
        "side", (22, 78, 140),
        {"app": "bank", "amount": 60, "transaction_id": "RAAST20261124778899", "receiver_name": "DHA WORKS", "status": "success"},
    )
    render(
        "sadapay_ok", "SadaPay", "Money Sent",
        [("You sent", "Rs. 100"), ("Reference", "SP7788990011"), ("To", "DHA WORKS"), ("Account", "0300 *****67"), ("Date", "22 Nov 2026 09:10 PM")],
        "stacked", (30, 30, 36),
        {"app": "sadapay", "amount": 100, "transaction_id": "SP7788990011", "receiver_name": "DHA WORKS", "status": None},  # headline "Money Sent" has no success word: unknown, never a guess
    )
    render(
        "jazzcash_failed", "JazzCash", "Transaction Failed",
        [("Amount", "Rs. 50.00"), ("Transaction ID", "555500001111"), ("Sent to", "DHA WORKS"), ("Date & Time", "24 Nov 2026 03:45 PM")],
        "side", (214, 31, 40),
        {"app": "jazzcash", "amount": 50, "transaction_id": "555500001111", "receiver_name": "DHA WORKS", "status": "failed"},
    )
    print("made", len(list(OUT.glob("*.png"))), "pictures in", OUT)


if __name__ == "__main__":
    main()
