from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000, description="Tin nhắn từ user")
    workflow: Literal["plan", "tracking", "qa", "understanding", "recover", "reflect"] | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    response: str = Field(..., description="Phản hồi từ agent")
    workflow: str
    mode: str | None = None
    status: str = "completed"
    pending_action: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    proposed_milestones: list[dict[str, Any]] = Field(default_factory=list)
    recovery_options: list[dict[str, Any]] = Field(default_factory=list)
    reflection_draft: dict[str, Any] | None = None
    assessment_result: dict[str, Any] | None = None
    progress_metrics: dict[str, Any] = Field(default_factory=dict)
    risk_signals: list[dict[str, Any]] = Field(default_factory=list)
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
