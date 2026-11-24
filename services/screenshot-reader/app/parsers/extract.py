"""From rows of text to the fixed fields the database compares. No verdicts here: a field that is not clearly there is None.

The label sets in PROFILES are STARTER sets for each app. They are tuned on the real sample screenshots (see README, accuracy gate);
until then a row that does not fit simply gives None and the payment shows "Could not read" for that field.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .common import amounts_in, parse_amount, parse_datetime, parse_status, parse_transaction_id, visible_account

APPS = ("jazzcash", "easypaisa", "sadapay", "nayapay", "bank")

# Words that identify the app (checked on every row, lower case). Bank apps are last: the others are more specific.
_APP_WORDS: dict[str, tuple[str, ...]] = {
    "jazzcash": ("jazzcash", "jazz cash", "mobilink microfinance"),
    "easypaisa": ("easypaisa", "easy paisa", "telenor microfinance"),
    "sadapay": ("sadapay", "sada pay"),
    "nayapay": ("nayapay", "naya pay"),
    "bank": ("iban", "raast", "1link", "hbl", "meezan", "ubl", "mcb", "allied bank", "bank alfalah", "faysal", "askari", "habib bank", "bank al habib", "standard chartered", "js bank", "bank transfer", "funds transfer"),
}


@dataclass(frozen=True)
class Profile:
    amount: tuple[str, ...] = ("amount", "total amount", "amount sent", "amount transferred", "transfer amount", "you sent", "paid amount", "sent amount")
    txn: tuple[str, ...] = ("transaction id", "transaction no", "transaction number", "trx id", "txn id", "tid", "reference no", "reference number", "reference", "ref no", "stan", "ibft reference")
    date: tuple[str, ...] = ("date", "date & time", "date and time", "time", "dated", "transaction date", "paid on", "sent on")
    name: tuple[str, ...] = ("sent to", "to", "receiver", "receiver name", "beneficiary", "beneficiary name", "recipient", "transferred to", "account title", "account name", "paid to")
    account: tuple[str, ...] = ("account number", "account no", "account", "to account", "receiver account", "mobile number", "mobile no", "wallet", "iban", "beneficiary account", "receiver number")
    extra_txn: tuple[str, ...] = field(default_factory=tuple)


# Per-app additions on top of the shared sets (a place to tune on real screenshots; empty additions mean the shared set already covers it).
PROFILES: dict[str, Profile] = {
    "jazzcash": Profile(extra_txn=("tid", "trans id")),
    "easypaisa": Profile(extra_txn=("tid", "transaction id")),
    "sadapay": Profile(extra_txn=("reference",)),
    "nayapay": Profile(extra_txn=("reference", "ref")),
    "bank": Profile(extra_txn=("ibft", "rrn")),
}
_GENERIC = Profile()


def detect_app(rows: list[str]) -> str | None:
    text = "\n".join(rows).lower()
    for app in APPS:
        if any(w in text for w in _APP_WORDS[app]):
            return app
    return None


def _label_re(labels: tuple[str, ...]) -> re.Pattern[str]:
    # a label at the start of a row (after bullets or symbols), as a whole word, then whatever follows it on the row
    alts = "|".join(re.escape(label).replace(r"\ ", r"\s+") for label in sorted(labels, key=len, reverse=True))
    return re.compile(rf"^\W*(?:{alts})\b\W*(.*)$", re.I)


def _labelled(rows: list[str], labels: tuple[str, ...], lookahead: int = 1) -> list[str]:
    """For each row that starts with one of the labels: the rest of that row, and the next `lookahead` rows (the value is often below)."""
    rx = _label_re(labels)
    out: list[str] = []
    for i, row in enumerate(rows):
        m = rx.match(row)
        if m:
            out.append(m.group(1))
            out.extend(rows[i + 1:i + 1 + lookahead])
    return out


_NOT_AMOUNT_ROW = re.compile(r"\b(?:fee|fees|charge|charges|balance|tax|fed|commission|limit)\b", re.I)


def extract_amount(rows: list[str], profile: Profile) -> float | int | None:
    """The transfer amount. One clear value only: several different candidates (an amount and a fee, say) is None, never a guess."""
    rx = _label_re(profile.amount)
    labelled: list[float | int] = []
    for i, row in enumerate(rows):
        m = rx.match(row)
        if not m or _NOT_AMOUNT_ROW.search(row):
            continue
        for cand in (m.group(1), rows[i + 1] if i + 1 < len(rows) and not _NOT_AMOUNT_ROW.search(rows[i + 1]) else ""):
            v = parse_amount(cand) if cand.strip() else None
            if v is not None:
                labelled.append(v)
                break
    if labelled:
        return labelled[0] if len(set(labelled)) == 1 else None
    loose = [a for row in rows if not _NOT_AMOUNT_ROW.search(row) for a in amounts_in(row)]
    return loose[0] if loose and len(set(loose)) == 1 else None


def extract_txn(rows: list[str], profile: Profile) -> str | None:
    for cand in _labelled(rows, profile.txn + profile.extra_txn, lookahead=1):
        v = parse_transaction_id(cand)
        if v:
            return v
    return None


def extract_date(rows: list[str], profile: Profile) -> str | None:
    for cand in _labelled(rows, profile.date, lookahead=1):
        v = parse_datetime(cand)
        if v:
            return v
    for row in rows:  # a date on a row of its own, with no label
        v = parse_datetime(row)
        if v:
            return v
    return None


_NAME = re.compile(r"([A-Za-z][A-Za-z .'&\-]{2,59})")


def extract_receiver(rows: list[str], profile: Profile) -> tuple[str | None, str | None]:
    """(name, visible account digits). A name is letters only; a number goes to the account, never the name."""
    name = None
    for cand in _labelled(rows, profile.name, lookahead=1):
        m = _NAME.match(cand.strip())
        if m and sum(ch.isalpha() for ch in m.group(1)) >= 3:
            name = m.group(1).strip()
            break
    account = None
    for cand in _labelled(rows, profile.account, lookahead=1) + _labelled(rows, profile.name, lookahead=2):
        v = visible_account(cand)
        if v:
            account = v
            break
    return name, account


def extract(rows: list[str]) -> dict[str, object]:
    """The fixed shape the database expects (public.dues_check_apply, p_extracted). Every field may be None."""
    app = detect_app(rows)
    profile = PROFILES.get(app or "", _GENERIC)
    name, account = extract_receiver(rows, profile)
    return {
        "app": app,
        "amount": extract_amount(rows, profile),
        "transaction_id": extract_txn(rows, profile),
        "paid_at": extract_date(rows, profile),
        "receiver_name": name,
        "receiver_account": account,
        "status": parse_status(rows),
    }
