import json

import pytest

from evals.run_ragas_eval import load_samples


def test_ragas_dataset_requires_at_least_one_hundred_samples(tmp_path):
    path = tmp_path / "small.jsonl"
    sample = {
        "user_input": "Câu hỏi",
        "response": "Câu trả lời",
        "retrieved_contexts": ["Tài liệu"],
        "reference": "Đáp án tham chiếu",
    }
    path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="at least 100 samples"):
        load_samples(path)


def test_ragas_dataset_accepts_one_hundred_complete_samples(tmp_path):
    path = tmp_path / "valid.jsonl"
    sample = {
        "user_input": "Câu hỏi",
        "response": "Câu trả lời",
        "retrieved_contexts": ["Tài liệu"],
        "reference": "Đáp án tham chiếu",
    }
    path.write_text(
        "\n".join(json.dumps(sample, ensure_ascii=False) for _ in range(100)),
        encoding="utf-8",
    )

    assert len(load_samples(path)) == 100
