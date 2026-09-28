from fastapi import APIRouter, HTTPException

from src.agents.graph import agent
from src.agents.session_tokens import InvalidSessionTokenError, create_session_token, verify_session_token
from src.config import get_settings
from src.models.schemas import ChatRequest, ChatResponse

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Chat với AI agent."""
    settings = get_settings()
    if settings.app_env == "production" and settings.agent_session_secret == "development-only-change-me":
        raise HTTPException(status_code=503, detail="Agent session secret is not configured")
    try:
        if request.session_id:
            thread_id = verify_session_token(request.session_id, settings.agent_session_secret)
            session_token = request.session_id
        else:
            session_token, thread_id = create_session_token(
                settings.agent_session_secret,
                settings.agent_session_ttl_seconds,
            )
    except InvalidSessionTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc

    config = {"configurable": {"thread_id": thread_id}}
    try:
        result = await agent.ainvoke(
            {
                "query": request.message,
                "request": {"channel": "api"},
                "role": "student",
            },
            config=config,
        )
        return ChatResponse(
            response=result.get("response", ""),
            analysis="",
            session_id=session_token,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Agent request failed") from exc


@router.get("/status")
async def agent_status():
    """Kiểm tra trạng thái agent."""
    return {"status": "ready", "agent": "LangGraph Agent v1.0"}
