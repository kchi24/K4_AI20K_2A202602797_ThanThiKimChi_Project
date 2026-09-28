from src.agents.evaluation import (
    grounding_safety_dataset,
    planning_dataset,
    run_full_evaluation,
    understanding_journey_dataset,
)


def test_each_versioned_dataset_has_at_least_120_samples():
    assert len(planning_dataset()) >= 120
    assert len(grounding_safety_dataset()) >= 120
    assert len(understanding_journey_dataset()) >= 120


def test_deterministic_release_metrics_pass():
    report = run_full_evaluation()
    assert report["overall_pass"] is True
    assert all(report["passed"].values())
