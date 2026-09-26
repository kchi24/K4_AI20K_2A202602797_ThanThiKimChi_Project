from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000, description="Tin nhắn từ user")
    session_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        description="Mã phiên hội thoại; bỏ trống để hệ thống tạo phiên mới",
    )


class ChatResponse(BaseModel):
    response: str = Field(..., description="Phản hồi từ agent")
    analysis: str = Field(default="", description="Phân tích nội bộ")
    session_id: str = Field(..., description="Mã phiên dùng cho các lượt chat tiếp theo")
