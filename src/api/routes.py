from uuid import uuid4

from fastapi import APIRouter, HTTPException

from src.agents.graph import agent
from src.models.schemas import ChatRequest, ChatResponse

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Chat với AI agent."""
    session_id = request.session_id or f"api_{uuid4().hex}"
    config = {"configurable": {"thread_id": session_id}}
    try:
        result = await agent.ainvoke({"query": request.message}, config=config)
        return ChatResponse(
            response=result.get("response", ""),
            analysis=result.get("analysis", ""),
            session_id=session_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/status")
async def agent_status():
    """Kiểm tra trạng thái agent."""
    return {"status": "ready", "agent": "LangGraph Agent v1.0"}
