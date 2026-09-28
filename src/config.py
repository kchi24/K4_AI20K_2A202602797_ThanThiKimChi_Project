from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "AI20K Agent"
    app_env: Literal["development", "production", "test"] = "development"
    app_port: int = Field(default=8000, ge=1, le=65535)
    app_host: str = "0.0.0.0"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_origins: str = "http://localhost:3000"
    agent_session_secret: str = "development-only-change-me"
    agent_session_ttl_seconds: int = Field(default=86400, ge=300, le=604800)

    # LLM
    openai_api_key: str = ""
    openai_base_url: str = "https://openrouter.ai/api/v1"
    model_name: str = "openai/gpt-4o-mini"
    llm_temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    # Database
    database_url: str = "sqlite:///./data/app.db"

    # Vector Store
    vector_store_type: str = "qdrant"
    qdrant_path: str = "./src/agents/data/qdrant"
    chroma_persist_dir: str = "./src/agents/data/chroma"


@lru_cache
def get_settings() -> Settings:
    return Settings()
