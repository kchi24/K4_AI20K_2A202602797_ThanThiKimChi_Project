"""
Tools hỗ trợ kiểm tra và đánh giá rubric xác định trước.
Cung cấp công cụ chấm điểm câu hỏi đóng không tốn LLM token và parser chuẩn hóa barem chấm điểm Canvas LMS.
"""

import re
from typing import Any


def _extract_choice_token(text: str) -> tuple[str, str]:
    """
    Tách ký tự đáp án (A, B, C, D hoặc 1, 2, 3...) và nội dung phía sau nếu có.
    Ví dụ: 'A. Lạm phát tăng' -> ('A', 'Lạm phát tăng')
           'Phương án B' -> ('B', '')
           '(c)' -> ('C', '')
    """
    cleaned = text.strip()
    match = re.match(
        r"^(?:đáp án|phương án|câu|chọn|option)?\s*[\(\[]?([A-Za-z0-9])[\)\]\.\:\-]?\s*(.*)$",
        cleaned,
        re.IGNORECASE,
    )

    if match:
        token = match.group(1).upper()
        remainder = match.group(2).strip().lower()
        return token, remainder
    return "", cleaned.lower()


def evaluate_closed_question(student_answer: str, correct_answer: str) -> dict:
    """
    Chấm điểm câu hỏi trắc nghiệm / câu hỏi đóng theo đáp án chuẩn mà không tốn token LLM.

    Hỗ trợ:
    - Khớp chính xác chuỗi (không phân biệt hoa thường, khoảng trắng).
    - Khớp ký tự chữ cái đáp án: ví dụ học sinh chọn 'A' và đáp án chuẩn là 'A. Đúng' hoặc ngược lại.
    - Chuẩn hóa Đúng/Sai (True/False).

    Args:
        student_answer: Câu trả lời do sinh viên nhập/chọn.
        correct_answer: Đáp án chuẩn của câu hỏi.

    Returns:
        dict: {
            "is_correct": bool,
            "student_answer": str,
            "correct_answer": str,
            "feedback": str
        }
    """
    s_raw = str(student_answer or "").strip()
    c_raw = str(correct_answer or "").strip()

    s_clean = s_raw.lower()
    c_clean = c_raw.lower()

    # 1. So khớp trực tiếp chuỗi đã làm sạch
    if s_clean == c_clean:
        is_correct = True
    else:
        # 2. Xử lý chuẩn hóa True / False / Đúng / Sai
        tf_map = {
            "true": "T", "t": "T", "đúng": "T", "dung": "T", "1": "T",
            "false": "F", "f": "F", "sai": "F", "0": "F",
        }
        if s_clean in tf_map and c_clean in tf_map:
            is_correct = tf_map[s_clean] == tf_map[c_clean]
        else:
            # 3. Tách ký tự lựa chọn (A, B, C, D...)
            s_token, s_rem = _extract_choice_token(s_raw)
            c_token, c_rem = _extract_choice_token(c_raw)

            if s_token and c_token and s_token == c_token:
                is_correct = True
            elif s_token and not c_token and s_clean == c_clean:
                is_correct = True
            elif s_rem and c_rem and s_rem == c_rem:
                is_correct = True
            else:
                is_correct = False

    feedback = (
        f"Chính xác! Đáp án chuẩn là '{c_raw}'."
        if is_correct
        else f"Chưa chính xác. Đáp án của bạn: '{s_raw}'. Đáp án đúng là '{c_raw}'."
    )

    return {
        "is_correct": is_correct,
        "student_answer": s_raw,
        "correct_answer": c_raw,
        "feedback": feedback,
    }


def parse_approved_rubric(rubric_data: dict | list | None) -> list[dict]:
    """
    Chuẩn hóa barem điểm của giảng viên thành danh sách các tiêu chí và mức độ đạt được
    theo đúng cấu trúc chuẩn của Canvas LMS.

    Hỗ trợ các định dạng:
    1. Chuẩn Canvas LMS API: dict có key 'criteria', mỗi tiêu chí có 'ratings'.
    2. Dict có key 'rubric' hoặc 'items'.
    3. List các tiêu chí trực tiếp.
    4. Key-value dict dạng: {'Tên tiêu chí': ['Mức 1', 'Mức 2', ...]}.

    Returns:
        list[dict]: Danh sách tiêu chí chuẩn hóa, mỗi tiêu chí gồm:
            - 'criterion_id': str
            - 'name': str
            - 'description': str
            - 'max_points': float | None
            - 'levels': list[dict] (gồm level_id, name, description, points)
    """
    if not rubric_data:
        return []

    raw_criteria: list[Any] = []

    # 1. Trích xuất danh sách criteria thô
    if isinstance(rubric_data, list):
        raw_criteria = rubric_data
    elif isinstance(rubric_data, dict):
        if "criteria" in rubric_data and isinstance(rubric_data["criteria"], list):
            raw_criteria = rubric_data["criteria"]
        elif "rubric" in rubric_data and isinstance(rubric_data["rubric"], list):
            raw_criteria = rubric_data["rubric"]
        elif "items" in rubric_data and isinstance(rubric_data["items"], list):
            raw_criteria = rubric_data["items"]
        else:
            # Trường hợp dict ánh xạ {tên tiêu chí: levels}
            parsed_from_dict = []
            for idx, (crit_name, val) in enumerate(rubric_data.items()):
                levels = []
                if isinstance(val, list):
                    for l_idx, lvl in enumerate(val):
                        if isinstance(lvl, dict):
                            levels.append(lvl)
                        else:
                            levels.append({"level_id": f"lvl_{l_idx + 1}", "name": str(lvl), "points": None})
                elif isinstance(val, dict):
                    levels = val.get("levels", val.get("ratings", []))

                parsed_from_dict.append({
                    "id": f"crit_{idx + 1}",
                    "description": str(crit_name),
                    "ratings": levels,
                })
            raw_criteria = parsed_from_dict

    normalized: list[dict] = []
    for idx, item in enumerate(raw_criteria):
        if not isinstance(item, dict):
            continue

        crit_id = str(item.get("id") or item.get("criterion_id") or f"crit_{idx + 1}")
        name = str(item.get("description") or item.get("name") or item.get("title") or f"Tiêu chí {idx + 1}")
        desc = str(item.get("long_description") or item.get("details") or name)

        points = item.get("points")
        max_points = float(points) if points is not None else None

        # Chuẩn hóa các mức đánh giá (levels / ratings)
        raw_ratings = item.get("ratings") or item.get("levels") or item.get("scale") or []
        normalized_levels = []

        if isinstance(raw_ratings, list):
            for l_idx, r in enumerate(raw_ratings):
                if isinstance(r, dict):
                    l_id = str(r.get("id") or r.get("level_id") or f"lvl_{l_idx + 1}")
                    l_name = str(r.get("description") or r.get("name") or r.get("title") or f"Mức {l_idx + 1}")
                    l_desc = str(r.get("long_description") or r.get("details") or l_name)
                    l_pts = r.get("points")
                    normalized_levels.append({
                        "level_id": l_id,
                        "name": l_name,
                        "description": l_desc,
                        "points": float(l_pts) if l_pts is not None else None,
                    })
                elif isinstance(r, str):
                    normalized_levels.append({
                        "level_id": f"lvl_{l_idx + 1}",
                        "name": r,
                        "description": r,
                        "points": None,
                    })

        normalized.append({
            "criterion_id": crit_id,
            "name": name,
            "description": desc,
            "max_points": max_points,
            "levels": normalized_levels,
        })

    return normalized

