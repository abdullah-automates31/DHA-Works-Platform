from app.engines.base import OcrLine, lines_to_rows
from app.engines.paddle import normalise


def test_boxes_on_one_visual_row_are_joined_left_to_right():
    lines = [OcrLine("Rs. 1,500.00", x=300, y=102, h=20), OcrLine("Amount", x=20, y=100, h=20), OcrLine("Sent to", x=20, y=160, h=20), OcrLine("DHA WORKS", x=300, y=158, h=20)]
    assert lines_to_rows(lines) == ["Amount  Rs. 1,500.00", "Sent to  DHA WORKS"]


def test_rows_run_top_to_bottom_whatever_the_order_the_engine_gave():
    lines = [OcrLine("third", x=0, y=300, h=20), OcrLine("first", x=0, y=10, h=20), OcrLine("second", x=0, y=150, h=20)]
    assert lines_to_rows(lines) == ["first", "second", "third"]


def test_blank_boxes_and_nothing_at_all():
    assert lines_to_rows([]) == []
    assert lines_to_rows([OcrLine("   ", 0, 0, 10)]) == []


def test_paddle_2x_answer_shape():
    raw = [[[[[10, 10], [110, 10], [110, 30], [10, 30]], ("Amount", 0.99)], [[[200, 12], [300, 12], [300, 32], [200, 32]], ("Rs 200", 0.97)], "garbage"]]
    lines = normalise(raw)
    assert [(ln.text, ln.x, round(ln.y), round(ln.h), ln.conf) for ln in lines] == [("Amount", 10.0, 20, 20, 0.99), ("Rs 200", 200.0, 22, 20, 0.97)]


def test_paddle_2x_empty_page():
    assert normalise([None]) == []
    assert normalise(None) == []


def test_paddle_3x_answer_shape():
    page = {"rec_texts": ["Amount", "Rs 200", ""], "rec_scores": [0.9, 0.8, 0.7], "rec_polys": [[[0, 0], [50, 0], [50, 20], [0, 20]], [[100, 2], [150, 2], [150, 22], [100, 22]], [[0, 0], [1, 0], [1, 1], [0, 1]]]}
    lines = normalise([page])
    assert [ln.text for ln in lines] == ["Amount", "Rs 200"]  # the empty text is dropped
    assert lines[1].x == 100.0


def test_paddle_3x_rectangular_boxes():
    page = {"rec_texts": ["Hello"], "rec_scores": [0.5], "rec_boxes": [[10, 20, 60, 40]]}
    ln = normalise([page])[0]
    assert (ln.text, ln.x, ln.y, ln.h) == ("Hello", 10.0, 30.0, 20.0)
