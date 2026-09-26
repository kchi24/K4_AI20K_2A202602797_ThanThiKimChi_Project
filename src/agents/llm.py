"""
Khởi tạo và cấu hình LLM cho các Agent trong hệ thống.
"""

import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from src.config import get_settings

load_dotenv()

# Tắt tạm tracing nếu key LangSmith là dummy để tránh spam log 403 trên terminal
os.environ["LANGCHAIN_TRACING_V2"] = "false"


def get_agent_llm(model: str | None = None, temperature: float = 0.7) -> ChatOpenAI:
    """
    Trả về đối tượng ChatOpenAI được cấu hình từ .env.
    Tự động chọn mô hình hoạt động phù hợp nhất với proxy endpoint.
    """
    settings = get_settings()

    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")
    base_url = settings.openai_base_url or os.getenv("OPENAI_BASE_URL", "")

    # Ưu tiên model hợp lệ của proxy
    if model:
        chosen_model = model
    elif os.getenv("MODEL_NAME") and not os.getenv("MODEL_NAME", "").startswith("your-"):
        chosen_model = os.getenv("MODEL_NAME")
    elif "screensavers-nutten" in base_url:
        chosen_model = "cx/gpt-5.6-luna"
    else:
        chosen_model = os.getenv("MODEL") or settings.model_name or "cx/gpt-5.6-luna"

    return ChatOpenAI(
        model=chosen_model,
        api_key=api_key,
        base_url=base_url,
        temperature=temperature,
        timeout=90.0,
        max_retries=1,
    )
