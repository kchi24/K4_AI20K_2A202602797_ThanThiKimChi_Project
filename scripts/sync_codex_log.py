#!/usr/bin/env python3
"""Recover VS Code Codex prompts missed by a project lifecycle hook.

Codex keeps a local rollout for each conversation. This script reads only
rollouts started in this repository and appends missing user prompts to the
same pending AI log used by the live hook. It is safe to run more than once.
"""

import json
import os
import subprocess
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

VN_TZ = timezone(timedelta(hours=7))
LOG_DIR = Path(os.environ.get("AI_LOG_DIR", ".ai-log"))
CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def _git(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def _same_path(left: str, right: str) -> bool:
    def normalize(value: str) -> str:
        if value.startswith("\\\\?\\"):
            value = value[4:]
        return os.path.normcase(os.path.normpath(value))

    return normalize(left) == normalize(right)


def _logged_turns() -> set[tuple[str, str]]:
    seen = set()
    for path in [LOG_DIR / "session.jsonl", *LOG_DIR.glob("archive/*.jsonl")]:
        if not path.is_file():
            continue
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (
                    entry.get("tool") == "codex"
                    and entry.get("event") == "UserPromptSubmit"
                    and entry.get("turn_id")
                ):
                    seen.add((entry.get("session_id", ""), entry["turn_id"]))
    return seen


def _entries(rollout: Path, repo_root: str, seen: set[tuple[str, str]]):
    with rollout.open(encoding="utf-8") as stream:
        first = stream.readline()
        try:
            header = json.loads(first)
        except json.JSONDecodeError:
            return
        if header.get("type") != "session_meta":
            return
        meta = header.get("payload") or {}
        if meta.get("source") != "vscode" or not _same_path(
            meta.get("cwd", ""), repo_root
        ):
            return

        session_id = meta.get("id") or meta.get("session_id") or ""
        for line in stream:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = item.get("payload") or {}
            if (
                item.get("type") != "response_item"
                or message.get("type") != "message"
                or message.get("role") != "user"
            ):
                continue
            metadata = message.get("internal_chat_message_metadata_passthrough") or {}
            if "user.text" not in metadata.get("content_item_kinds", []):
                continue  # IDE context and other synthetic user messages
            turn_id = metadata.get("turn_id") or ""
            if not turn_id or (session_id, turn_id) in seen:
                continue
            prompt = "\n".join(
                part.get("text", "")
                for part in message.get("content", [])
                if part.get("type") == "input_text" and part.get("text")
            )
            if not prompt:
                continue
            seen.add((session_id, turn_id))
            try:
                ts = datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                ts = datetime.now(UTC)
            yield {
                "ts": ts.astimezone(VN_TZ).isoformat(),
                "tool": "codex",
                "event": "UserPromptSubmit",
                "session_id": session_id,
                "model": "",
                "repo": Path(repo_root).name,
                "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
                "commit": _git("rev-parse", "--short", "HEAD"),
                "student": _git("config", "user.email"),
                "prompt": prompt[:1000],
                "turn_id": turn_id,
                "transcript_path": str(rollout),
            }


def main() -> None:
    repo_root = _git("rev-parse", "--show-toplevel")
    sessions = CODEX_HOME / "sessions"
    if not repo_root or not sessions.is_dir():
        return
    seen = _logged_turns()
    recovered = []
    for rollout in sessions.rglob("rollout-*.jsonl"):
        try:
            recovered.extend(_entries(rollout, repo_root, seen))
        except (OSError, UnicodeError):
            continue  # A conversation may still be writing its rollout.
    if not recovered:
        print("[ai-log] No missed Codex VS Code prompts.")
        return
    recovered.sort(key=lambda entry: entry["ts"])
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "session.jsonl").open("a", encoding="utf-8") as stream:
        for entry in recovered:
            stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"[ai-log] Recovered {len(recovered)} Codex VS Code prompts.")


if __name__ == "__main__":
    main()
