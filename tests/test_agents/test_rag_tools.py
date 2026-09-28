import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from src.agents.tools import qdrant_retriever
from src.agents.tools.qdrant_retriever import (
    ingest_sample_documents,
    parse_markdown_document,
    record_disputed_evidence,
    search_course_materials,
)


@pytest.fixture
def fake_qdrant_models(monkeypatch):
    parent = ModuleType("qdrant_client")
    models = ModuleType("qdrant_client.models")

    class DataObject:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class Distance:
        COSINE = "cosine"

    models.Distance = Distance
    models.PointStruct = DataObject
    models.VectorParams = DataObject
    models.FieldCondition = DataObject
    models.Filter = DataObject
    models.MatchValue = DataObject
    parent.models = models
    monkeypatch.setitem(sys.modules, "qdrant_client", parent)
    monkeypatch.setitem(sys.modules, "qdrant_client.models", models)
    return models


class FakeEmbedding:
    def embed(self, texts):
        return [FakeVector([float(index + 1), 0.0, 0.0]) for index, _ in enumerate(texts)]


class FakeVector(list):
    def tolist(self):
        return list(self)


class FakeQdrantClient:
    def __init__(self, exists=True, points=None):
        self.exists = exists
        self.points = points or []
        self.recreated = None
        self.upserted = []
        self.last_query = None

    def collection_exists(self, _name):
        return self.exists

    def recreate_collection(self, **kwargs):
        self.exists = True
        self.recreated = kwargs

    def upsert(self, **kwargs):
        self.upserted = kwargs["points"]

    def query_points(self, **kwargs):
        self.last_query = kwargs
        return SimpleNamespace(points=self.points)


def test_parse_structured_markdown_document(tmp_path: Path):
    document = tmp_path / "lesson.md"
    document.write_text(
        "# Nhập môn AI\n\n**Mã học phần:** AI101\n\n"
        "### [Trang 1, Đoạn 2] - Học có giám sát\n"
        "Học có giám sát sử dụng dữ liệu đã gán nhãn.",
        encoding="utf-8",
    )
    chunks = parse_markdown_document(document)
    assert len(chunks) == 1
    assert chunks[0]["course_code"] == "AI101"
    assert chunks[0]["citation"] == "[Nhập môn AI, Trang 1, Đoạn 2]"


def test_parse_plain_markdown_uses_fallback_chunks(tmp_path: Path):
    document = tmp_path / "plain.md"
    document.write_text(
        "# Bài học\n\nĐây là một đoạn nội dung đủ dài để bộ tách tạo thành một đoạn học liệu kiểm thử.",
        encoding="utf-8",
    )
    chunks = parse_markdown_document(document)
    assert chunks
    assert chunks[0]["page"] == 1


def test_record_disputed_evidence_adds_audit_event():
    state = {}
    result = record_disputed_evidence(state, "[Nguồn, Trang 1]", "Sai trang", "Em thấy sai")
    assert result["status"] == "recorded"
    assert state["disputed_evidence"][0]["status"] == "flagged_for_review"
    assert state["audit_events"][0]["event"] == "CITATION_DISPUTED"


def test_ingest_documents_with_fake_vector_backend(tmp_path, monkeypatch, fake_qdrant_models):
    document = tmp_path / "lesson.md"
    document.write_text(
        "# AI\n\n**Mã học phần:** AI101\n\n"
        "### [Trang 1, Đoạn 1] - Khái niệm\nNội dung đủ dài để ingest.",
        encoding="utf-8",
    )
    client = FakeQdrantClient(exists=False)
    monkeypatch.setattr(qdrant_retriever, "_get_embedding_model", lambda: FakeEmbedding())
    result = ingest_sample_documents(tmp_path, client=client, force_recreate=True)
    assert result["status"] == "success"
    assert result["total_chunks"] == 1
    assert client.recreated is not None
    assert client.upserted[0].payload["course_code"] == "AI101"


def test_ingest_empty_directory_returns_warning(tmp_path, fake_qdrant_models):
    result = ingest_sample_documents(tmp_path, client=FakeQdrantClient())
    assert result["status"] == "warning"
    assert result["total_chunks"] == 0


def test_search_missing_collection_refuses(fake_qdrant_models):
    result = search_course_materials("khái niệm", client=FakeQdrantClient(exists=False))
    assert result["insufficient_sources"] is True
    assert result["passages"] == []


def test_search_filters_course_and_returns_passage(monkeypatch, fake_qdrant_models):
    point = SimpleNamespace(
        id=1,
        score=0.91,
        payload={
            "chunk_id": "c1",
            "content": "Nội dung",
            "document_title": "Giáo trình",
            "course_code": "AI101",
            "page": 2,
            "paragraph": 3,
            "section_title": "Khái niệm",
            "citation": "[Giáo trình, Trang 2, Đoạn 3]",
        },
    )
    client = FakeQdrantClient(points=[point])
    monkeypatch.setattr(qdrant_retriever, "_get_embedding_model", lambda: FakeEmbedding())
    result = search_course_materials("khái niệm", course_code="AI101", client=client)
    assert result["insufficient_sources"] is False
    assert result["top_score"] == 0.91
    assert result["passages"][0]["citation"] == "[Giáo trình, Trang 2, Đoạn 3]"
    assert client.last_query["query_filter"] is not None
