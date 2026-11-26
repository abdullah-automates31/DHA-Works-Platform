"""Small, pure normalisers for what a payment screen says. They never guess: when the text is unclear they return None, and the database
then flags the payment ("could not read") instead of trusting a wrong number."""
from __future__ import annotations

import re
from datetime import date

_AMOUNT = re.compile(r"(?:rs\.?|pkr|rupees?)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)", re.I)


def parse_amount(text: str) -> float | int | None:
    """'Rs. 1,500.00' -> 1500, 'PKR 1500' -> 1500, '200.50' -> 200.5. Zero and anything without a digit is None."""
    m = _AMOUNT.search(text or "")
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    if value <= 0:
        return None
    return int(value) if value == int(value) else round(value, 2)


def amounts_in(text: str) -> list[float | int]:
    """Every amount written with a currency word ('Rs 200', 'PKR 1,500.00'), in order. Bare numbers are NOT amounts here (IDs, phone numbers)."""
    found: list[float | int] = []
    for m in re.finditer(r"(?:rs\.?|pkr|rupees?)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)", text or "", re.I):
        v = float(m.group(1).replace(",", ""))
        if v > 0:
            found.append(int(v) if v == int(v) else round(v, 2))
    return found


_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12}
_D_MON_Y = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{4})")
_MON_D_Y = re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})")
_Y_M_D = re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")
_D_M_Y = re.compile(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})")
_TIME = re.compile(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]?\.?|(\d{1,2}):(\d{2})(?::\d{2})?")


def _valid(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_datetime(text: str) -> str | None:
    """'24 Nov 2026 02:35 PM' -> '2026-11-24T14:35', 'Nov 24, 2026' -> '2026-11-24', '24/11/2026' -> '2026-11-24' (day first, as in Pakistan).

    A date that does not exist, or that cannot be told apart (two-digit years), is None. The time is added only when it is next to the date.
    """
    text = text or ""
    found: tuple[date, int] | None = None  # the date and where it ends in the text
    for rx, order in ((_D_MON_Y, "dmy"), (_MON_D_Y, "mdy"), (_Y_M_D, "ymd"), (_D_M_Y, "dmy_num")):
        m = rx.search(text)
        if not m:
            continue
        a, b, c = m.group(1), m.group(2), m.group(3)
        if order == "dmy":
            mon = _MONTHS.get(b.lower()[:4] if b.lower().startswith("sept") else b.lower()[:3])
            d = _valid(int(c), mon, int(a)) if mon else None
        elif order == "mdy":
            mon = _MONTHS.get(a.lower()[:4] if a.lower().startswith("sept") else a.lower()[:3])
            d = _valid(int(c), mon, int(b)) if mon else None
        elif order == "ymd":
            d = _valid(int(a), int(b), int(c))
        else:
            d = _valid(int(c), int(b), int(a))
        if d:
            found = (d, m.end())
            break
    if not found:
        return None
    d, end = found
    out = d.isoformat()
    t = _TIME.search(text[max(0, end - 1):])
    if t and t.start() <= 6:
        if t.group(1) is not None:
            hh, mm, ap = int(t.group(1)), int(t.group(2)), t.group(3).lower()
            if 1 <= hh <= 12 and mm < 60:
                hh = (hh % 12) + (12 if ap == "p" else 0)
                out += f"T{hh:02d}:{mm:02d}"
        else:
            hh, mm = int(t.group(4)), int(t.group(5))
            if hh < 24 and mm < 60:
                out += f"T{hh:02d}:{mm:02d}"
    return out


_ID = re.compile(r"([A-Za-z0-9][A-Za-z0-9\-]{5,39})")


def parse_transaction_id(text: str) -> str | None:
    """The first token that looks like a transaction ID: 6 to 40 letters, digits and dashes with at least one digit. Dates and phone-like
    numbers with a leading 0 and 11 digits are not IDs."""
    for m in _ID.finditer(text or ""):
        tok = m.group(1).strip("-")
        if len(tok) < 6 or not any(ch.isdigit() for ch in tok):
            continue
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", tok) or re.fullmatch(r"0\d{10}", tok):
            continue
        return tok
    return None


_MASK = re.compile(r"[*xX•·#]")
_DATEISH = re.compile(r"(?<!\d)\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?!\d)|(?<!\d)\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)|(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)")


def visible_account(text: str) -> str | None:
    """Only what is really shown of an account number. '0300 *** 4567' -> '4567'; 'PK36HABB0000123456789001' stays whole; a phone
    number '+92 300 1234567' -> '923001234567'. Fewer than 3 visible trailing characters -> None (the receiver's name decides)."""
    # An IBAN (PK + 22-24 chars); or a Pakistani mobile (03xx..., 11 digits); or a phone with formatting (+, spaces, dashes);
    # or a MASKED number (at least one * x # mark, with 3+ visible trailing digits).
    # A bare run of 12+ digits with NO formatting is a transaction ID, not an account.
    # A short run of digits (a date such as "2026 03:45", an amount, a time) is never an account.
    text = _DATEISH.sub(" ", text or "")
    # IBAN (Pakistan: PK + 22-24 chars) - return full match
    m = re.search(r"PK\d{2}[A-Z0-9]{4,}\d{16}", text, re.I)
    if m:
        return m.group(0)
    # Pakistani mobile: raw 11 digits starting with 03
    m = re.search(r"\b03\d{9}\b", text)
    if m:
        return m.group(0)
    # Phone with formatting: +92..., 0300-..., 0300 ..., or masked with * x # (3+ visible trailing digits)
    m = re.search(r"(\+?\d[\d\s\-]{8,}\d|[0-9xX*•·#\s\-]*[*xX•·#][0-9xX*•·#\s\-]*\d{3,})", text, re.I)
    if not m:
        return None
    token = m.group(1) if m.lastindex else m.group(0)
    # Must have some formatting (space, dash, +, or mask char) or be an IBAN - otherwise it's a raw txn ID
    if not re.search(r"[\s\-\+*xX•·#]", token):
        return None
    if len(re.sub(r"\s", "", token)) < 6:
        return None
    parts = _MASK.split(token)
    tail = re.sub(r"[^A-Za-z0-9]", "", parts[-1]) if len(parts) > 1 else re.sub(r"[^A-Za-z0-9]", "", token)
    return tail if len(tail) >= 3 else None


_FAILED = re.compile(r"\b(?:failed|failure|unsuccessful|declined|rejected|cancell?ed|reversed|insufficient)\b", re.I)
_PENDING = re.compile(r"\b(?:pending|processing|in\s+progress|under\s+review)\b", re.I)
_SUCCESS = re.compile(r"\b(?:successful(?:ly)?|success|completed|approved|paid|sent)\b", re.I)


def parse_status(rows: list[str]) -> str | None:
    """'failed' if any row says so, else 'pending' if any says so, else 'success' if a row says it went through, else None."""
    text = "\n".join(rows)
    if _FAILED.search(text):
        return "failed"
    if _PENDING.search(text):
        return "pending"
    if re.search(r"\b(?:successful(?:ly)?|success|completed|approved)\b", text, re.I) or re.search(r"\bsent\s+(?:to|successfully)\b", text, re.I):
        return "success"
    return None
