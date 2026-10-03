import pytest

from src.agents.tools.rubric_evaluator import evaluate_closed_question, parse_approved_rubric


@pytest.mark.parametrize(
    ("student", "correct", "expected"),
    [
        ("A", "A. Đáp án", True),
        ("đúng", "True", True),
        ("B", "A", False),
        ("Nội dung", "nội dung", True),
    ],
)
def test_evaluate_closed_question(student, correct, expected):
    assert evaluate_closed_question(student, correct)["is_correct"] is expected


def test_parse_canvas_rubric():
    result = parse_approved_rubric(
        {
            "criteria": [
                {
                    "id": "c1",
                    "description": "Đúng khái niệm",
                    "points": 4,
                    "ratings": [{"id": "r1", "description": "Đạt", "points": 4}],
                }
            ]
        }
    )
    assert result[0]["criterion_id"] == "c1"
    assert result[0]["levels"][0]["points"] == 4.0


def test_parse_mapping_rubric():
    result = parse_approved_rubric({"Lập luận": ["Tốt", "Cần cải thiện"]})
    assert result[0]["name"] == "Lập luận"
    assert len(result[0]["levels"]) == 2
