"""Run semantic RAGAS metrics on at least 100 labeled PaceWise samples."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def load_samples(path: Path) -> list[dict[str, Any]]:
    samples = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(samples) < 100:
        raise ValueError(f"RAGAS requires at least 100 samples; received {len(samples)}")
    required = {"user_input", "response", "retrieved_contexts", "reference"}
    for index, sample in enumerate(samples):
        missing = required - sample.keys()
        if missing:
            raise ValueError(f"sample {index} is missing {sorted(missing)}")
    return samples


def run(samples: list[dict[str, Any]]) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for RAGAS judge calls")
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import answer_relevancy, context_precision, context_recall, faithfulness
    except ImportError as exc:
        raise RuntimeError("Install requirements.txt before running RAGAS") from exc

    dataset = Dataset.from_list(samples)
    result = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
    )
    frame = result.to_pandas()
    metrics = {
        name: round(float(frame[name].dropna().mean()), 4)
        for name in ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
        if name in frame
    }
    return {"sample_count": len(samples), "metrics": metrics, "passed": metrics.get("faithfulness", 0) >= 0.8}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="JSONL produced from real PaceWise QA traces")
    parser.add_argument("--output", type=Path, default=Path("evals/reports/ragas-latest.json"))
    args = parser.parse_args()
    report = run(load_samples(args.input))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
