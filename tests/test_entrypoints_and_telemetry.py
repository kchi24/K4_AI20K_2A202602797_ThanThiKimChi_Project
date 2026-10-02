import builtins
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


def test_model_usage_callback_records_tokens_cost_and_errors(monkeypatch):
    from src.agents import telemetry

    calls = []
    monkeypatch.setattr(telemetry, "increment", lambda name, **labels: calls.append((name, labels)))
    monkeypatch.setattr(
        telemetry,
        "get_settings",
        lambda: SimpleNamespace(
            llm_input_cost_per_million=2.0,
            llm_output_cost_per_million=4.0,
        ),
    )
    callback = telemetry.ModelUsageCallback()
    callback.on_llm_end(
        SimpleNamespace(
            llm_output={
                "model_name": "test-model",
                "token_usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 20,
                    "total_tokens": 120,
                },
            }
        )
    )
    callback.on_llm_error(RuntimeError("provider failed"))

    assert ("pacewise_llm_calls_total", {"model": "test-model", "outcome": "ok"}) in calls
    assert any(name == "pacewise_llm_tokens_total" for name, _labels in calls)
    assert any(name == "pacewise_llm_estimated_cost_usd_total" for name, _labels in calls)
    assert calls[-1][1]["outcome"] == "error"


def test_llm_factories_apply_runtime_configuration(monkeypatch):
    from src.agents import llm as agent_llm
    from src.services import llm as service_llm

    created = []

    def fake_chat_openai(**kwargs):
        created.append(kwargs)
        return kwargs

    settings = SimpleNamespace(
        openai_api_key="api-key",
        openai_base_url="https://llm.example/v1",
        model_name="fallback-model",
        llm_temperature=0.2,
    )
    monkeypatch.setattr(agent_llm, "get_settings", lambda: settings)
    monkeypatch.setattr(agent_llm, "ChatOpenAI", fake_chat_openai)
    monkeypatch.setenv("MODEL_NAME", "runtime-model")
    result = agent_llm.get_agent_llm(temperature=0.1)
    assert result["model"] == "runtime-model"
    assert result["callbacks"]

    assert agent_llm.get_agent_llm(model="explicit-model")["model"] == "explicit-model"
    monkeypatch.delenv("MODEL_NAME")
    settings.openai_base_url = "https://screensavers-nutten.example/v1"
    assert agent_llm.get_agent_llm()["model"] == "cx/gpt-5.6-luna"
    settings.openai_base_url = "https://llm.example/v1"
    assert agent_llm.get_agent_llm()["model"] == "fallback-model"

    monkeypatch.setattr(service_llm, "get_settings", lambda: settings)
    monkeypatch.setattr(service_llm, "ChatOpenAI", fake_chat_openai)
    result = service_llm.get_llm()
    assert result["model"] == "fallback-model"
    assert result["temperature"] == 0.2


@pytest.mark.asyncio
async def test_agent_cli_handles_state_new_message_and_exit(monkeypatch, capsys):
    from src.agents import __main__ as cli

    inputs = iter(["/state", "/new", "help me plan", "exit"])
    monkeypatch.setattr(builtins, "input", lambda _prompt="": next(inputs))
    fake_agent = SimpleNamespace(
        get_state=lambda _config: SimpleNamespace(
            values={
                "current_node": "plan",
                "workflow": "plan",
                "proposed_milestones": [
                    {"milestone_id": "m1", "title": "Read", "estimated_minutes": 30}
                ],
                "retrieved_passages": [{"id": 1}],
                "disputed_evidence": [],
            }
        ),
        ainvoke=AsyncMock(
            return_value={
                "workflow": "plan",
                "current_node": "quality_gate",
                "response": "A complete and safe weekly study plan.",
                "proposed_milestones": [{"milestone_id": "m1"}],
            }
        ),
    )
    monkeypatch.setattr(cli, "agent", fake_agent)

    await cli.main()

    output = capsys.readouterr().out
    assert "quality_gate" in output
    fake_agent.ainvoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_agent_cli_falls_back_to_recovery_text(monkeypatch, capsys):
    from src.agents import __main__ as cli

    inputs = iter(["recover", "q"])
    monkeypatch.setattr(builtins, "input", lambda _prompt="": next(inputs))
    monkeypatch.setattr(
        "src.agents.workflows.recover._format_options_as_text",
        lambda _options: "Choose a recovery option",
    )
    monkeypatch.setattr(
        cli,
        "agent",
        SimpleNamespace(
            ainvoke=AsyncMock(
                return_value={
                    "workflow": "recover",
                    "current_node": "recover",
                    "response": "short",
                    "recovery_options": [{"id": "r1"}],
                }
            )
        ),
    )

    await cli.main()

    assert "Choose a recovery option" in capsys.readouterr().out


def test_ingest_cli_reports_success_and_failure(monkeypatch, capsys):
    from src.agents import ingest

    monkeypatch.setattr(
        ingest,
        "ingest_sample_documents",
        lambda **_kwargs: {
            "status": "success",
            "collection_name": "course_materials",
            "total_chunks": 3,
            "files_processed": ["syllabus.md"],
        },
    )
    ingest.main()
    assert "course_materials" in capsys.readouterr().out

    monkeypatch.setattr(
        ingest,
        "ingest_sample_documents",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("bad document")),
    )
    with pytest.raises(SystemExit) as stopped:
        ingest.main()
    assert stopped.value.code == 1


def test_worker_entrypoint_initializes_and_runs(monkeypatch):
    from src import worker

    settings = SimpleNamespace(log_level="INFO")
    initialized = []
    monkeypatch.setattr(worker, "get_settings", lambda: settings)
    monkeypatch.setattr(worker, "initialize_database", lambda: initialized.append(True))

    async def fake_worker(received):
        assert received is settings

    monkeypatch.setattr(worker, "run_worker", fake_worker)
    worker.main()
    assert initialized == [True]


@pytest.mark.asyncio
async def test_application_lifespan_starts_and_stops_dependencies(monkeypatch):
    from src import main

    events = []

    class FakeBroker:
        def __init__(self, settings):
            self.settings = settings

        async def start(self):
            events.append("broker-start")

        async def stop(self):
            events.append("broker-stop")

    @asynccontextmanager
    async def fake_runtime_agent(_settings):
        events.append("agent-start")
        yield "durable-agent"
        events.append("agent-stop")

    monkeypatch.setattr(main, "initialize_database", lambda: events.append("db"))
    monkeypatch.setattr(main, "LmsEventBroker", FakeBroker)
    monkeypatch.setattr(main, "runtime_agent", fake_runtime_agent)

    async with main.lifespan(main.app):
        assert main.app.state.agent == "durable-agent"

    assert events == ["db", "broker-start", "agent-start", "agent-stop", "broker-stop"]
