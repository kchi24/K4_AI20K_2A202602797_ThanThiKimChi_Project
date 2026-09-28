"""
Công cụ RAG & Truy xuất tài liệu học tập sử dụng Qdrant Vector Store (Local / Embedded).
Tích hợp:
- Bóc tách tài liệu học liệu theo cấu trúc chuẩn [Trang X, Đoạn Y].
- Embedding cục bộ bằng FastEmbed (ONNX BAAI/bge-small-en-v1.5, 384 dim).
- Qdrant Vector Database lưu trữ trên disk hoặc in-memory.
- Truy xuất tương đồng Cosine và phân định ngưỡng an toàn (insufficient_sources).
- Xử lý khiếu nại trích dẫn (disputed_evidence) & lưu vết kiểm toán (audit_events).
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastembed import TextEmbedding
    from qdrant_client import QdrantClient

from src.config import get_settings

AGENTS_DIR = Path(__file__).resolve().parent.parent
AGENTS_DATA_DIR = AGENTS_DIR / "data"
DEFAULT_DOCS_DIR = AGENTS_DATA_DIR / "sample_documents"
DEFAULT_QDRANT_PATH = str(AGENTS_DATA_DIR / "qdrant")

DEFAULT_COLLECTION_NAME = "course_materials"
DEFAULT_SCORE_THRESHOLD = 0.72  # Ngưỡng tương đồng cosine để phân định học liệu phù hợp (>0.73 cho bài học, <0.71 cho câu hỏi lạc đề)
EMBEDDING_DIM = 384

_embedding_model: TextEmbedding | None = None
_embedding_model_lock = Lock()


def is_embedding_model_loaded() -> bool:
    """Return whether FastEmbed has been initialized in this process."""
    return _embedding_model is not None


def _get_embedding_model() -> TextEmbedding:
    """Load FastEmbed once, on the first request that actually needs a vector."""
    global _embedding_model
    if _embedding_model is not None:
        return _embedding_model

    # Double-checked locking prevents concurrent first requests from loading
    # several ONNX sessions and temporarily multiplying memory usage.
    with _embedding_model_lock:
        if _embedding_model is None:
            from fastembed import TextEmbedding

            _embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _embedding_model


def _get_qdrant_client(storage_path: str | None = None) -> QdrantClient:
    """
    Khởi tạo QdrantClient local theo đường dẫn cấu hình.
    Ưu tiên lưu trữ cục bộ trong src/agents/data/qdrant.
    Nếu storage_path là ':memory:', khởi tạo in-memory (rất hữu ích cho testing).
    """
    from qdrant_client import QdrantClient

    settings = get_settings()
    path = storage_path or getattr(settings, "qdrant_path", None) or DEFAULT_QDRANT_PATH

    if path == ":memory:":
        return QdrantClient(":memory:")

    if path in ("./data/qdrant", "data/qdrant"):
        path = DEFAULT_QDRANT_PATH

    os.makedirs(path, exist_ok=True)
    return QdrantClient(path=path)


def parse_markdown_document(file_path: str | Path) -> list[dict[str, Any]]:
    """
    Bóc tách tài liệu markdown học liệu thành các đoạn văn bản (passages) có cấu trúc.
    Nhận diện metadata tài liệu (tiêu đề, mã học phần) và từng đoạn với nhãn [Trang X, Đoạn Y].
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Không tìm thấy tài liệu: {file_path}")

    text = path.read_text(encoding="utf-8")

    # 1. Trích xuất tiêu đề tài liệu & mã học phần
    doc_title = path.stem.replace("_", " ").title()
    course_code = "GEN101"

    title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    if title_match:
        doc_title = title_match.group(1).strip()

    course_match = re.search(r"\*\*Mã học phần:\*\*\s*([A-Za-z0-9_-]+)", text)
    if course_match:
        course_code = course_match.group(1).strip()

    # 2. Bóc tách từng đoạn học liệu dựa trên mẫu: ### [Trang X, Đoạn Y] - Tiêu đề
    section_pattern = re.compile(
        r"###\s*\[Trang\s*(\d+),\s*Đoạn\s*(\d+)\]\s*-\s*([^\n]+)\n(.*?)(?=(?:\n###\s*\[Trang|\Z))",
        re.DOTALL,
    )

    chunks: list[dict[str, Any]] = []
    matches = list(section_pattern.finditer(text))

    if matches:
        for idx, match in enumerate(matches):
            page = int(match.group(1))
            paragraph = int(match.group(2))
            section_title = match.group(3).strip()
            content = match.group(4).strip()

            citation_tag = f"[{doc_title}, Trang {page}, Đoạn {paragraph}]"
            chunk_id = f"{path.stem}_p{page}_d{paragraph}_{idx}"

            chunks.append(
                {
                    "chunk_id": chunk_id,
                    "document_title": doc_title,
                    "course_code": course_code,
                    "page": page,
                    "paragraph": paragraph,
                    "section_title": section_title,
                    "citation": citation_tag,
                    "content": f"{section_title}\n{content}",
                    "file_path": str(path.as_posix()),
                }
            )
    else:
        # Fallback nếu văn bản không dùng chuẩn định dạng [Trang X, Đoạn Y]
        paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 40]
        for idx, p in enumerate(paragraphs):
            page = (idx // 3) + 1
            para_num = (idx % 3) + 1
            citation_tag = f"[{doc_title}, Trang {page}, Đoạn {para_num}]"
            chunks.append(
                {
                    "chunk_id": f"{path.stem}_chunk_{idx}",
                    "document_title": doc_title,
                    "course_code": course_code,
                    "page": page,
                    "paragraph": para_num,
                    "section_title": doc_title,
                    "citation": citation_tag,
                    "content": p,
                    "file_path": str(path.as_posix()),
                }
            )

    return chunks


def ingest_sample_documents(
    docs_dir: str | Path | None = None,
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
    force_recreate: bool = False,
) -> dict[str, Any]:
    """
    Quét thư mục tài liệu mẫu và nạp (ingest) dữ liệu vào Qdrant Vector Store.
    Sử dụng FastEmbed để sinh vector embeddings và lưu trữ payload đầy đủ metadata.
    """
    from qdrant_client.models import Distance, PointStruct, VectorParams

    if docs_dir is None:
        docs_dir = DEFAULT_DOCS_DIR if DEFAULT_DOCS_DIR.exists() else Path("data/sample_documents")
    else:
        docs_dir = Path(docs_dir)

    if not docs_dir.exists():
        raise FileNotFoundError(f"Thư mục tài liệu mẫu không tồn tại: {docs_dir}")

    qdrant = client or _get_qdrant_client(storage_path)

    all_chunks: list[dict[str, Any]] = []
    files_processed: list[str] = []

    for file_path in docs_dir.glob("*.md"):
        chunks = parse_markdown_document(file_path)
        all_chunks.extend(chunks)
        files_processed.append(file_path.name)

    if not all_chunks:
        return {
            "status": "warning",
            "message": "Không tìm thấy đoạn văn bản nào để nạp.",
            "total_chunks": 0,
            "files": files_processed,
        }

    embed_model = _get_embedding_model()

    # Tạo hoặc khởi tạo lại collection trong Qdrant
    if force_recreate or not qdrant.collection_exists(collection_name):
        qdrant.recreate_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )

    # Sinh vector embeddings cho từng đoạn văn bản
    texts = [f"{c['document_title']}\n{c['content']}" for c in all_chunks]
    embeddings = list(embed_model.embed(texts))

    points: list[PointStruct] = []
    for idx, (chunk, vec) in enumerate(zip(all_chunks, embeddings), start=1):
        points.append(
            PointStruct(
                id=idx,
                vector=vec.tolist() if hasattr(vec, "tolist") else list(vec),
                payload={
                    "chunk_id": chunk["chunk_id"],
                    "document_title": chunk["document_title"],
                    "course_code": chunk["course_code"],
                    "page": chunk["page"],
                    "paragraph": chunk["paragraph"],
                    "section_title": chunk["section_title"],
                    "citation": chunk["citation"],
                    "content": chunk["content"],
                    "file_path": chunk["file_path"],
                },
            )
        )

    # Upsert points vào Qdrant
    qdrant.upsert(collection_name=collection_name, points=points)

    return {
        "status": "success",
        "collection_name": collection_name,
        "total_chunks": len(all_chunks),
        "files_processed": files_processed,
    }


def search_course_materials(
    query: str,
    top_k: int = 3,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
    course_code: str | None = None,
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
) -> dict[str, Any]:
    """
    Truy xuất các đoạn văn bản liên quan nhất từ Qdrant cho câu hỏi của sinh viên.
    Tự động tính similarity score và đánh giá độ tin cậy của nguồn (insufficient_sources).
    """
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    qdrant = client or _get_qdrant_client(storage_path)

    # Kiểm tra collection có tồn tại không
    if not qdrant.collection_exists(collection_name):
        return {
            "passages": [],
            "insufficient_sources": True,
            "top_score": 0.0,
            "message": f"Bộ sưu tập học liệu '{collection_name}' chưa được nạp dữ liệu.",
        }

    # Sinh embedding cho câu hỏi
    embed_model = _get_embedding_model()
    query_vec = list(embed_model.embed([query]))[0]

    # Truy vấn điểm tương đồng gần nhất từ Qdrant
    query_filter = None
    if course_code:
        query_filter = Filter(
            must=[FieldCondition(key="course_code", match=MatchValue(value=course_code))]
        )

    query_res = qdrant.query_points(
        collection_name=collection_name,
        query=query_vec.tolist() if hasattr(query_vec, "tolist") else list(query_vec),
        query_filter=query_filter,
        limit=top_k,
        with_payload=True,
    )

    passages: list[dict[str, Any]] = []
    top_score = 0.0

    for point in query_res.points:
        score = float(point.score) if point.score is not None else 0.0
        if score > top_score:
            top_score = score

        payload = point.payload or {}
        citation = payload.get("citation") or f"[{payload.get('document_title', 'Tài liệu')}, Trang {payload.get('page', '?')}]"

        passages.append(
            {
                "chunk_id": payload.get("chunk_id", str(point.id)),
                "content": payload.get("content", ""),
                "document_title": payload.get("document_title", ""),
                "course_code": payload.get("course_code", ""),
                "page": payload.get("page", 1),
                "paragraph": payload.get("paragraph", 1),
                "section_title": payload.get("section_title", ""),
                "citation": citation,
                "score": round(score, 4),
            }
        )

    # Đánh giá xem có thỏa mãn ngưỡng an toàn hay không
    is_insufficient = (len(passages) == 0) or (top_score < score_threshold)

    return {
        "passages": passages,
        "insufficient_sources": is_insufficient,
        "top_score": round(top_score, 4),
        "score_threshold": score_threshold,
    }


def record_disputed_evidence(
    state: dict[str, Any],
    citation: str,
    reason: str,
    student_note: str = "",
) -> dict[str, Any]:
    """
    Task 2.3: Xử lý phản hồi khiếu nại trích dẫn.
    Ghi nhận cờ `disputed_evidence` khi sinh viên đánh dấu trích dẫn không đúng hoặc tài liệu lỗi thời.
    Cập nhật đồng thời vào state và audit log.
    """
    dispute_entry = {
        "dispute_id": f"disp_{datetime.now().strftime('%Y%m%d%H%M%S%f')[:17]}",
        "citation": citation,
        "reason": reason,
        "student_note": student_note,
        "timestamp": datetime.now().isoformat(),
        "status": "flagged_for_review",
    }

    current_disputes = list(state.get("disputed_evidence") or [])
    current_disputes.append(dispute_entry)
    state["disputed_evidence"] = current_disputes

    audit_entry = {
        "event": "CITATION_DISPUTED",
        "citation": citation,
        "reason": reason,
        "timestamp": datetime.now().isoformat(),
    }
    audit_events = list(state.get("audit_events") or [])
    audit_events.append(audit_entry)
    state["audit_events"] = audit_events

    return {
        "status": "recorded",
        "dispute": dispute_entry,
        "message": f"Hệ thống đã tiếp nhận phản hồi khiếu nại cho trích dẫn '{citation}'. Thông tin đã được chuyển tới Giảng viên/Ban học vụ để rà soát.",
    }
