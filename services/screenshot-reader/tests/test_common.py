from app.parsers.common import amounts_in, parse_amount, parse_datetime, parse_status, parse_transaction_id, visible_account


def test_amounts():
    assert parse_amount("Rs. 1,500.00") == 1500
    assert parse_amount("PKR 1500") == 1500
    assert parse_amount("Rs 200") == 200
    assert parse_amount("200.50") == 200.5
    assert parse_amount("1,234,567") == 1234567
    assert parse_amount("Rs 0") is None
    assert parse_amount("nothing here") is None
    assert parse_amount("") is None


def test_only_currency_marked_numbers_are_amounts_when_searching_loosely():
    assert amounts_in("Rs 200 sent to 03001234567 ref 12345678") == [200]
    assert amounts_in("Fee PKR 5.00  Amount Rs. 1,500") == [5, 1500]
    assert amounts_in("03001234567") == []


def test_dates():
    assert parse_datetime("24 Nov 2026") == "2026-11-24"
    assert parse_datetime("24 Nov 2026 02:35 PM") == "2026-11-24T14:35"
    assert parse_datetime("24 November 2026, 12:05 AM") == "2026-11-24T00:05"
    assert parse_datetime("Nov 24, 2026 09:10 am") == "2026-11-24T09:10"
    assert parse_datetime("2026-11-24 18:30:55") == "2026-11-24T18:30"
    assert parse_datetime("24/11/2026") == "2026-11-24"
    assert parse_datetime("24-11-2026 14:30") == "2026-11-24T14:30"
    assert parse_datetime("5th Sept 2026") == "2026-09-05"


def test_dates_that_cannot_be_trusted_are_nothing():
    assert parse_datetime("30 Feb 2026") is None
    assert parse_datetime("2026-13-01") is None
    assert parse_datetime("yesterday") is None
    assert parse_datetime("24/11/26") is None  # two-digit years are not guessed
    assert parse_datetime("") is None


def test_a_time_far_from_the_date_is_not_attached():
    assert parse_datetime("24 Nov 2026 -- balance updated at 11:11") == "2026-11-24"


def test_transaction_ids():
    assert parse_transaction_id("12345678901") == "12345678901"
    assert parse_transaction_id("TX-AAA-1111") == "TX-AAA-1111"
    assert parse_transaction_id(": TID 8841209977 ") == "8841209977"
    assert parse_transaction_id("03001234567") is None  # a phone number
    assert parse_transaction_id("2026-11-24") is None  # a date
    assert parse_transaction_id("DHA WORKS") is None
    assert parse_transaction_id("12") is None


def test_visible_account():
    assert visible_account("0300 *** 4567") == "4567"
    assert visible_account("03*******67") is None  # only two digits shown: not enough, the name decides
    assert visible_account("03XX XXXX567") == "567"  # three digits shown (Easypaisa style)
    assert visible_account("PK36HABB0000123456789001") == "PK36HABB0000123456789001"
    assert visible_account("+92 300 1234567") == "923001234567"
    assert visible_account("03001234567") == "03001234567"
    assert visible_account("DHA Works") is None
    # found by the first real OCR run (25 Nov): digits of a date or a time were read as an account
    assert visible_account("24 Nov 2026 03:45 PM") is None
    assert visible_account("23 Nov 2026 11:20 AM") is None
    assert visible_account("24-11-2026 16:02") is None
    assert visible_account("Rs. 1,250.00") is None
    assert visible_account("0300 *****67") is None  # two digits shown: the name decides
    assert visible_account("PK36XXXX0000001234567890") == "PK36XXXX0000001234567890"


def test_status():
    assert parse_status(["Transaction Successful"]) == "success"
    assert parse_status(["Payment completed"]) == "success"
    assert parse_status(["Transaction failed"]) == "failed"
    assert parse_status(["Transaction Successful", "Failed attempts: 0"]) == "failed"  # a doubt is never read as success
    assert parse_status(["Processing"]) == "pending"
    assert parse_status(["Amount", "Rs 200"]) is None
