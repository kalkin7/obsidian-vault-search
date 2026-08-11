from __future__ import annotations

import re


def extract_content(text: str) -> str:
    if text.startswith("---"):
        match = re.match(r"^---\s*\r?\n.*?\r?\n---\s*(?:\r?\n|$)", text, re.DOTALL)
        if match:
            return text[match.end():]
    return text


def chunk_text(text: str, chunk_chars: int = 400, overlap_chars: int = 60) -> list[str]:
    content = extract_content(text).strip()
    if not content:
        return []
    paragraphs = [p.strip() for p in re.split(r"\r?\n\s*\r?\n", content)
                  if len(p.strip()) >= 10]
    if not paragraphs:
        return []

    chunks: list[str] = []
    buffer: list[str] = []
    buffer_len = 0
    for paragraph in paragraphs:
        if len(paragraph) > chunk_chars:
            if buffer:
                chunks.append("\n\n".join(buffer))
                buffer, buffer_len = [], 0
            start = 0
            while start < len(paragraph):
                end = min(start + chunk_chars, len(paragraph))
                part = paragraph[start:end].strip()
                if len(part) >= 10:
                    chunks.append(part)
                start = end - overlap_chars if end < len(paragraph) else end
            continue

        if buffer and buffer_len + len(paragraph) > chunk_chars:
            chunks.append("\n\n".join(buffer))
            tail: list[str] = []
            tail_len = 0
            for previous in reversed(buffer):
                if tail_len + len(previous) <= overlap_chars:
                    tail.insert(0, previous)
                    tail_len += len(previous)
                else:
                    break
            buffer, buffer_len = tail, tail_len
        buffer.append(paragraph)
        buffer_len += len(paragraph)

    if buffer:
        chunks.append("\n\n".join(buffer))
    return [chunk for chunk in chunks if len(chunk.strip()) >= 10]
