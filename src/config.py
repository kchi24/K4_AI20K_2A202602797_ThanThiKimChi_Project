from functools import lru_cache
from pathlib import Path
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
    cors_origins: str = "http://localhost:5173"

    # Canvas LMS simulator integration. The service key never leaves the backend.
    lms_base_url: str = "http://127.0.0.1:8010"
    pacewise_api_key: str = ""
    pacewise_api_key_file: str = ""
    pacewise_session_secret: str = "development-only-change-this-session-secret"
    pacewise_session_secret_file: str = ""
    pacewise_session_cookie: str = "pacewise_session"
    pacewise_csrf_cookie: str = "pacewise_csrf"
    pacewise_session_minutes: int = Field(default=240, ge=5, le=1440)
    session_cookie_secure: bool = False
    login_rate_limit: int = Field(default=5, ge=1, le=100)
    login_rate_window_seconds: int = Field(default=600, ge=60, le=86400)
    lms_sync_interval_seconds: int = Field(default=30, ge=5, le=3600)
    force_https: bool = False

    # LLM
    openai_api_key: str = ""
    openai_base_url: str = "https://openrouter.ai/api/v1"
    model_name: str = "openai/gpt-4o-mini"
    llm_temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    # Database
    database_url: str = "sqlite:///./data/pacewise.db"
    use_postgres_checkpoint: bool = True

    # Vector Store
    vector_store_type: str = "qdrant"
    qdrant_path: str = "./data/qdrant"
    chroma_persist_dir: str = "./src/agents/data/chroma"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_cache_dir: str = "./data/models/fastembed"
    # Multilingual ONNX cross-encoder; loaded lazily only after retrieval.
    reranker_model: str = "ms-marco-MultiBERT-L-12"
    reranker_cache_dir: str = "./data/models/flashrank"
    rag_top_k: int = Field(default=8, ge=3, le=30)
    rag_final_k: int = Field(default=3, ge=1, le=10)
    rag_rerank_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    metrics_enabled: bool = True

    def model_post_init(self, __context: object) -> None:
        """Support Docker/Kubernetes/cloud secrets mounted as read-only files."""
        for value_field, file_field in (
            ("pacewise_api_key", "pacewise_api_key_file"),
            ("pacewise_session_secret", "pacewise_session_secret_file"),
        ):
            secret_file = getattr(self, file_field).strip()
            if secret_file:
                setattr(self, value_field, Path(secret_file).read_text(encoding="utf-8").strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
