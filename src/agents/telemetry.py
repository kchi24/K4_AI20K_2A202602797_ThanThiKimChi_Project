"""LangChain callback that records model usage without logging prompt content."""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from src.config import get_settings
from src.observability import increment


def _message_usage(response: Any) -> tuple[dict[str, Any], str | None]:
    """Read usage metadata from LangChain messages when llm_output is empty."""
    for batch in getattr(response, "generations", None) or []:
        for generation in batch:
            message = getattr(generation, "message", None)
            if message is None:
                continue
            response_metadata = getattr(message, "response_metadata", None) or {}
            usage = (
                getattr(message, "usage_metadata", None)
                or response_metadata.get("token_usage")
                or response_metadata.get("usage")
                or {}
            )
            model = response_metadata.get("model_name") or response_metadata.get("model")
            if usage or model:
                return usage, str(model) if model else None
    return {}, None


class ModelUsageCallback(BaseCallbackHandler):
    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        output = response.llm_output or {}
        message_usage, message_model = _message_usage(response)
        usage = output.get("token_usage") or output.get("usage") or message_usage
        model = str(output.get("model_name") or output.get("model") or message_model or "unknown")
        increment("pacewise_llm_calls_total", model=model, outcome="ok")
        observed_tokens: dict[str, float] = {}
        for token_type, keys in {
            "input": ("prompt_tokens", "input_tokens"),
            "output": ("completion_tokens", "output_tokens"),
            "total": ("total_tokens",),
        }.items():
            value = next((usage.get(key) for key in keys if usage.get(key) is not None), 0)
            if value:
                observed_tokens[token_type] = float(value)
                increment(
                    "pacewise_llm_tokens_total",
                    amount=float(value),
                    model=model,
                    token_type=token_type,
                )
        if not observed_tokens:
            increment("pacewise_llm_usage_missing_total", model=model)
        settings = get_settings()
        estimated_cost = (
            observed_tokens.get("input", 0) * settings.llm_input_cost_per_million
            + observed_tokens.get("output", 0) * settings.llm_output_cost_per_million
        ) / 1_000_000
        if estimated_cost:
            increment(
                "pacewise_llm_estimated_cost_usd_total",
                amount=estimated_cost,
                model=model,
            )

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        increment("pacewise_llm_calls_total", model="unknown", outcome="error")
