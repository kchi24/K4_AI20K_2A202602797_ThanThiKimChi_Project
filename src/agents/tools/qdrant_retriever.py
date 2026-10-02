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

import hashlib
import logging
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastembed import TextEmbedding
    from flashrank import Ranker
    from qdrant_client import QdrantClient

from src.agents.safety import evaluate_input_policy
from src.config import get_settings
from src.observability import observe_rag

logger = logging.getLogger("pacewise.rag")

AGENTS_DIR = Path(__file__).resolve().parent.parent
AGENTS_DATA_DIR = AGENTS_DIR / "data"
DEFAULT_DOCS_DIR = AGENTS_DATA_DIR / "sample_documents"
DEFAULT_QDRANT_PATH = str(AGENTS_DATA_DIR / "qdrant")

DEFAULT_COLLECTION_NAME = "course_materials"
DEFAULT_SCORE_THRESHOLD = (
    0.72  # Ngưỡng tương đồng cosine để phân định học liệu phù hợp (>0.73 cho bài học, <0.71 cho câu hỏi lạc đề)
)
EMBEDDING_DIM = 384

_embedding_model: TextEmbedding | None = None
_embedding_model_lock = Lock()
_reranker_model: Ranker | None = None
_reranker_model_lock = Lock()
_qdrant_clients: dict[str, QdrantClient] = {}
_qdrant_client_lock = Lock()
_ingestion_lock = Lock()
_ingested_resource_sets: set[str] = set()


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

            settings = get_settings()
            _embedding_model = TextEmbedding(
                model_name=settings.embedding_model,
                cache_dir=settings.embedding_cache_dir,
            )
    return _embedding_model


def _get_reranker_model() -> Ranker:
    """Load the cross-encoder only after vector retrieval produced candidates."""
    global _reranker_model
    if _reranker_model is not None:
        return _reranker_model
    with _reranker_model_lock:
        if _reranker_model is None:
            from flashrank import Ranker

            settings = get_settings()
            _reranker_model = Ranker(
                model_name=settings.reranker_model,
                cache_dir=settings.reranker_cache_dir,
            )
    return _reranker_model


def _lexical_score(query: str, content: str) -> float:
    query_terms = set(re.findall(r"\w+", query.casefold()))
    content_terms = set(re.findall(r"\w+", content.casefold()))
    return len(query_terms & content_terms) / max(1, len(query_terms))


def rerank_passages(query: str, passages: list[dict[str, Any]], top_k: int = 3) -> list[dict[str, Any]]:
    """Cross-encoder rerank with a deterministic lexical fallback."""
    if not passages:
        return []
    rerank_method = "cross_encoder"
    try:
        from flashrank import RerankRequest

        model = _get_reranker_model()
        request_passages = [
            {
                "id": index,
                "text": "\n".join(
                    part
                    for part in (
                        str(item.get("document_title", "")).strip(),
                        str(item.get("section_title", "")).strip(),
                        str(item.get("content", "")).strip(),
                    )
                    if part
                ),
                "meta": {"index": index},
            }
            for index, item in enumerate(passages)
        ]
        raw_ranked = list(model.rerank(RerankRequest(query=query, passages=request_passages)))
        scores_by_index = {
            int(item.get("id", item.get("meta", {}).get("index", 0))): float(item.get("score", 0))
            for item in raw_ranked
        }
        scores = [scores_by_index.get(index, 0.0) for index in range(len(passages))]
    except Exception as exc:
        rerank_method = "lexical_fallback"
        logger.warning("rag_reranker_fallback error=%s", type(exc).__name__)
        scores = [_lexical_score(query, str(item.get("content", ""))) for item in passages]
    ranked = []
    for passage, score in zip(passages, scores):
        item = dict(passage)
        item["rerank_score"] = round(score, 6)
        item["rerank_method"] = rerank_method
        ranked.append(item)
    return sorted(
        ranked,
        key=lambda item: (float(item.get("rerank_score", 0)), float(item.get("score", 0))),
        reverse=True,
    )[:top_k]


def _get_qdrant_client(storage_path: str | None = None) -> QdrantClient:
    """
    Khởi tạo QdrantClient local theo đường dẫn cấu hình.
    Ưu tiên lưu trữ cục bộ trong src/agents/data/qdrant.
    Nếu storage_path là ':memory:', khởi tạo in-memory (rất hữu ích cho testing).
    """
    from qdrant_client import QdrantClient

    settings = get_settings()
    remote_url = settings.qdrant_url.strip() if storage_path is None else ""
    path = storage_path or getattr(settings, "qdrant_path", None) or DEFAULT_QDRANT_PATH

    if path in ("./data/qdrant", "data/qdrant"):
        path = DEFAULT_QDRANT_PATH
    cache_key = f"url:{remote_url}" if remote_url else str(path)
    with _qdrant_client_lock:
        if cache_key not in _qdrant_clients:
            if remote_url:
                _qdrant_clients[cache_key] = QdrantClient(
                    url=remote_url,
                    api_key=settings.qdrant_api_key or None,
                )
            elif path == ":memory:":
                _qdrant_clients[cache_key] = QdrantClient(":memory:")
            else:
                os.makedirs(path, exist_ok=True)
                _qdrant_clients[cache_key] = QdrantClient(path=path)
        return _qdrant_clients[cache_key]


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


def ingest_course_resources(
    resources: list[dict[str, Any]],
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
) -> dict[str, Any]:
    """Idempotently index LMS-authorized resources with stable content-derived IDs."""
    from qdrant_client.models import Distance, PointStruct, VectorParams

    normalized = [item for item in resources if str(item.get("content") or "").strip()]
    if not normalized:
        return {"status": "empty", "total_chunks": 0}
    required_scope_fields = (
        "institution_id",
        "course_id",
        "resource_id",
        "resource_version",
        "access_scope",
    )
    for item in normalized:
        missing = [field for field in required_scope_fields if not str(item.get(field) or "").strip()]
        if missing:
            raise ValueError(f"RAG resource is missing scope fields: {', '.join(missing)}")
    resource_digests = [
        hashlib.sha256(
            "|".join(
                str(item.get(field) or "")
                for field in (
                    "institution_id",
                    "course_id",
                    "resource_id",
                    "resource_version",
                    "access_scope",
                    "page",
                    "paragraph",
                    "content",
                )
            ).encode()
        ).hexdigest()
        for item in normalized
    ]
    batch_key = hashlib.sha256(f"{collection_name}|{'|'.join(sorted(resource_digests))}".encode()).hexdigest()
    with _ingestion_lock:
        if batch_key in _ingested_resource_sets:
            return {"status": "unchanged", "total_chunks": len(normalized)}
        qdrant = client or _get_qdrant_client(storage_path)
        if not qdrant.collection_exists(collection_name):
            qdrant.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )
        texts = [f"{item.get('document_title', '')}\n{item['content']}" for item in normalized]
        vectors = list(_get_embedding_model().embed(texts))
        points = []
        for item, vector, digest in zip(normalized, vectors, resource_digests):
            payload = dict(item)
            payload["content_hash"] = digest
            points.append(
                PointStruct(
                    id=str(uuid.UUID(digest[:32])),
                    vector=vector.tolist() if hasattr(vector, "tolist") else list(vector),
                    payload=payload,
                )
            )
        qdrant.upsert(collection_name=collection_name, points=points, wait=True)
        _ingested_resource_sets.add(batch_key)
        return {"status": "success", "total_chunks": len(points)}


def delete_course_resources(
    *,
    institution_id: str,
    course_id: str,
    access_scope: str = "course",
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
) -> None:
    """Delete one tenant/course namespace before indexing a new snapshot."""
    from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue

    qdrant = client or _get_qdrant_client(storage_path)
    if not qdrant.collection_exists(collection_name):
        return
    qdrant.delete(
        collection_name=collection_name,
        points_selector=FilterSelector(
            filter=Filter(
                must=[
                    FieldCondition(key="institution_id", match=MatchValue(value=institution_id)),
                    FieldCondition(key="course_id", match=MatchValue(value=str(course_id))),
                    FieldCondition(key="access_scope", match=MatchValue(value=access_scope)),
                ]
            )
        ),
        wait=True,
    )


def delete_stale_course_resources(
    *,
    institution_id: str,
    course_id: str,
    current_snapshot_version: str,
    access_scope: str = "course",
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
) -> None:
    """Remove old points only after a new course snapshot was indexed."""
    from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue

    qdrant = client or _get_qdrant_client(storage_path)
    if not qdrant.collection_exists(collection_name):
        return
    qdrant.delete(
        collection_name=collection_name,
        points_selector=FilterSelector(
            filter=Filter(
                must=[
                    FieldCondition(key="institution_id", match=MatchValue(value=institution_id)),
                    FieldCondition(key="course_id", match=MatchValue(value=str(course_id))),
                    FieldCondition(key="access_scope", match=MatchValue(value=access_scope)),
                ],
                must_not=[
                    FieldCondition(
                        key="snapshot_version",
                        match=MatchValue(value=current_snapshot_version),
                    )
                ],
            )
        ),
        wait=True,
    )


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
    top_k: int | None = None,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
    course_code: str | None = None,
    institution_id: str | None = None,
    course_id: str | None = None,
    access_scope: str = "course",
    collection_name: str = DEFAULT_COLLECTION_NAME,
    storage_path: str | None = None,
    client: QdrantClient | None = None,
) -> dict[str, Any]:
    """
    Truy xuất các đoạn văn bản liên quan nhất từ Qdrant cho câu hỏi của sinh viên.
    Tự động tính similarity score và đánh giá độ tin cậy của nguồn (insufficient_sources).
    """
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    started = time.perf_counter()
    settings = get_settings()
    if bool(institution_id) != bool(course_id):
        raise ValueError("institution_id and course_id must be provided together")
    candidate_k = top_k or settings.rag_top_k
    qdrant = client or _get_qdrant_client(storage_path)

    # Kiểm tra collection có tồn tại không
    if not qdrant.collection_exists(collection_name):
        observe_rag("retrieve", "missing_collection", time.perf_counter() - started)
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
    conditions = []
    if institution_id:
        conditions.append(FieldCondition(key="institution_id", match=MatchValue(value=institution_id)))
    if course_id:
        conditions.append(FieldCondition(key="course_id", match=MatchValue(value=str(course_id))))
    if institution_id or course_id:
        conditions.append(FieldCondition(key="access_scope", match=MatchValue(value=access_scope)))
    elif course_code:
        # Backward-compatible path for sample documents and local CLI usage.
        conditions.append(FieldCondition(key="course_code", match=MatchValue(value=course_code)))
    if conditions:
        query_filter = Filter(must=conditions)

    query_res = qdrant.query_points(
        collection_name=collection_name,
        query=query_vec.tolist() if hasattr(query_vec, "tolist") else list(query_vec),
        query_filter=query_filter,
        limit=candidate_k,
        with_payload=True,
    )

    passages: list[dict[str, Any]] = []
    top_score = 0.0

    for point in query_res.points:
        score = float(point.score) if point.score is not None else 0.0
        if score > top_score:
            top_score = score

        payload = point.payload or {}
        content = str(payload.get("content") or "")
        # Retrieved chunks use targeted injection signals; running a remote
        # classifier for every passage would multiply latency and token cost.
        passage_policy = evaluate_input_policy(content, semantic_mode="signals")
        if passage_policy.get("action") == "block":
            logger.warning("rag_passage_blocked reason=prompt_injection point_id=%s", point.id)
            continue
        citation = (
            payload.get("citation")
            or f"[{payload.get('document_title', 'Tài liệu')}, Trang {payload.get('page', '?')}]"
        )

        passages.append(
            {
                "chunk_id": payload.get("chunk_id", str(point.id)),
                "content": content,
                "document_title": payload.get("document_title", ""),
                "course_code": payload.get("course_code", ""),
                "institution_id": payload.get("institution_id", ""),
                "course_id": payload.get("course_id", ""),
                "resource_id": payload.get("resource_id", ""),
                "resource_version": payload.get("resource_version", ""),
                "access_scope": payload.get("access_scope", ""),
                "page": payload.get("page", 1),
                "paragraph": payload.get("paragraph", 1),
                "section_title": payload.get("section_title", ""),
                "citation": citation,
                "score": round(score, 4),
            }
        )

    passages = rerank_passages(query, passages, settings.rag_final_k)
    top_rerank_score = float(passages[0].get("rerank_score", 0)) if passages else 0.0
    trusted_cross_encoder = bool(
        passages
        and passages[0].get("rerank_method") == "cross_encoder"
        and top_rerank_score >= settings.rag_rerank_threshold
    )
    # A calibrated semantic hit or a strong cross-encoder hit can ground an
    # answer. The lexical emergency fallback may reorder candidates, but it
    # never bypasses the abstention gate by itself.
    is_insufficient = (len(passages) == 0) or (top_score < score_threshold and not trusted_cross_encoder)
    outcome = "insufficient" if is_insufficient else "grounded"
    latency_seconds = time.perf_counter() - started
    observe_rag("retrieve", outcome, latency_seconds)

    return {
        "passages": passages,
        "insufficient_sources": is_insufficient,
        "top_score": round(top_score, 4),
        "top_rerank_score": round(top_rerank_score, 4),
        "score_threshold": score_threshold,
        "retrieval_latency_ms": round(latency_seconds * 1000, 2),
        "reranked": bool(passages and passages[0].get("rerank_method") == "cross_encoder"),
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

    audit_entry = {
        "event": "CITATION_DISPUTED",
        "citation": citation,
        "reason": reason,
        "timestamp": datetime.now().isoformat(),
    }
    current_disputes = [*(state.get("disputed_evidence") or []), dispute_entry]

    return {
        "status": "recorded",
        "dispute": dispute_entry,
        "disputed_evidence": current_disputes,
        # This is a delta. LangGraph's reducer appends it to durable history
        # exactly once instead of receiving the full history again.
        "audit_events": [audit_entry],
        "message": f"Hệ thống đã tiếp nhận phản hồi khiếu nại cho trích dẫn '{citation}'. Thông tin đã được chuyển tới Giảng viên/Ban học vụ để rà soát.",
    }
