from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class DocumentChunk:
    content: str
    embedding_text: str
    heading_path: tuple[str, ...]
    start_line: int
    end_line: int
    lexical_only: bool = False


@dataclass(frozen=True, slots=True)
class _Atom:
    content: str
    heading_path: tuple[str, ...]
    start_line: int
    end_line: int
    kind: str = "paragraph"
    complete: bool = True


_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_LIST = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
_CALLOUT = re.compile(r"^\s*>\s*\[![^]]+\]", re.IGNORECASE)
_SMALL_ATOM_CHARS = 10


def extract_content(text: str) -> str:
    if text.startswith("---"):
        match = re.match(r"^---\s*\r?\n.*?\r?\n---\s*(?:\r?\n|$)", text, re.DOTALL)
        if match:
            return text[match.end():]
    return text


def chunk_text(text: str, chunk_chars: int = 400, overlap_chars: int = 60) -> list[str]:
    """The original paragraph-v1 chunker. Keep this behavior stable."""
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


def chunk_document(
    text: str,
    file_path: str,
    chunk_chars: int = 400,
    overlap_chars: int = 60,
    strategy: str = "paragraph-v1",
) -> list[DocumentChunk]:
    if strategy == "paragraph-v1":
        return _paragraph_chunks(text, chunk_chars, overlap_chars)
    if strategy == "markdown-v2":
        return _markdown_chunks(text, file_path, chunk_chars, overlap_chars)
    raise ValueError(f"Unknown chunking strategy: {strategy}")


def _paragraph_chunks(text: str, chunk_chars: int, overlap_chars: int) -> list[DocumentChunk]:
    result: list[DocumentChunk] = []
    search_start = 0
    for content in chunk_text(text, chunk_chars, overlap_chars):
        position = text.find(content, search_start)
        if position < 0:
            start_line = end_line = 1
        else:
            start_line = text.count("\n", 0, position) + 1
            end_line = start_line + content.count("\n")
            search_start = position + 1
        result.append(DocumentChunk(content, content, (), start_line, end_line))
    return result


def _markdown_chunks(
    text: str,
    file_path: str,
    chunk_chars: int,
    overlap_chars: int,
) -> list[DocumentChunk]:
    title = Path(file_path).stem
    atoms = _parse_atoms(text)
    if not atoms:
        return [DocumentChunk(title, title, (), 1, 1, lexical_only=True)]

    atoms = _carry_short_atoms(atoms)
    expanded: list[_Atom] = []
    for atom in atoms:
        limit = chunk_chars * 2 if atom.kind in {"code", "table"} else chunk_chars
        expanded.extend(_split_atom(atom, limit))

    chunks: list[DocumentChunk] = []
    buffer: list[_Atom] = []

    def emit() -> None:
        nonlocal buffer
        if not buffer:
            return
        content = "\n\n".join(atom.content for atom in buffer).strip()
        if content:
            heading_path = buffer[0].heading_path
            chunks.append(DocumentChunk(
                content=content,
                embedding_text=_embedding_text(title, heading_path, content),
                heading_path=heading_path,
                start_line=buffer[0].start_line,
                end_line=buffer[-1].end_line,
            ))
        last = buffer[-1]
        buffer = [last] if last.complete and len(last.content) <= overlap_chars else []

    for atom in expanded:
        if buffer and atom.heading_path != buffer[0].heading_path:
            emit()
            buffer = []
        candidate_len = len(atom.content) + sum(len(item.content) + 2 for item in buffer)
        if buffer and candidate_len > chunk_chars:
            emit()
            if buffer and atom.heading_path != buffer[0].heading_path:
                buffer = []
        buffer.append(atom)
    emit()
    return chunks


def _parse_atoms(text: str) -> list[_Atom]:
    lines = text.splitlines()
    if not lines:
        return []
    lines[0] = lines[0].removeprefix("\ufeff")
    index = _frontmatter_end(lines)
    headings: list[tuple[int, str]] = []
    atoms: list[_Atom] = []

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue

        fence = _FENCE.match(line)
        if fence:
            start = index
            marker = fence.group(1)
            index += 1
            closing = re.compile(rf"^\s{{0,3}}{re.escape(marker[0])}{{{len(marker)},}}\s*$")
            while index < len(lines):
                current = lines[index]
                index += 1
                if closing.match(current):
                    break
            atoms.append(_atom(lines, start, index, headings, "code"))
            continue

        heading = _HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            while headings and headings[-1][0] >= level:
                headings.pop()
            headings.append((level, heading.group(2).strip()))
            index += 1
            continue

        start = index
        if _CALLOUT.match(line):
            index += 1
            while index < len(lines) and lines[index].lstrip().startswith(">"):
                index += 1
            atoms.append(_atom(lines, start, index, headings, "callout"))
            continue
        if _is_table_start(lines, index):
            index += 1
            while index < len(lines) and _is_table_row(lines[index]):
                index += 1
            atoms.append(_atom(lines, start, index, headings, "table"))
            continue
        if _LIST.match(line):
            index += 1
            while index < len(lines) and lines[index].strip():
                current = lines[index]
                if _LIST.match(current):
                    index += 1
                    continue
                if current.startswith(("  ", "\t")) and not _FENCE.match(current):
                    index += 1
                    continue
                if (_HEADING.match(current) or _FENCE.match(current)
                        or _CALLOUT.match(current) or _is_table_start(lines, index)):
                    break
                break
            atoms.append(_atom(lines, start, index, headings, "list"))
            continue

        index += 1
        while index < len(lines) and lines[index].strip():
            if (_HEADING.match(lines[index]) or _FENCE.match(lines[index])
                    or _CALLOUT.match(lines[index]) or _LIST.match(lines[index])
                    or _is_table_start(lines, index)):
                break
            index += 1
        atoms.append(_atom(lines, start, index, headings, "paragraph"))
    return [atom for atom in atoms if atom.content.strip()]


def _frontmatter_end(lines: list[str]) -> int:
    if not lines or lines[0].strip() != "---":
        return 0
    for index in range(1, len(lines)):
        if lines[index].strip() in {"---", "..."}:
            return index + 1
    return 0


def _atom(lines: list[str], start: int, end: int,
          headings: list[tuple[int, str]], kind: str) -> _Atom:
    return _Atom(
        content="\n".join(lines[start:end]).strip(),
        heading_path=tuple(title for _level, title in headings),
        start_line=start + 1,
        end_line=end,
        kind=kind,
    )


def _is_table_row(line: str) -> bool:
    stripped = line.strip()
    if not stripped or "|" not in stripped:
        return False
    cells = stripped.strip("|").split("|")
    return len(cells) >= 2 and any(cell.strip() for cell in cells)


def _is_table_delimiter(line: str) -> bool:
    stripped = line.strip().strip("|")
    cells = stripped.split("|")
    return len(cells) >= 2 and all(
        bool(re.fullmatch(r"\s*:?-{3,}:?\s*", cell)) for cell in cells
    )


def _is_table_start(lines: list[str], index: int) -> bool:
    return (index + 1 < len(lines) and _is_table_row(lines[index])
            and _is_table_delimiter(lines[index + 1]))


def _carry_short_atoms(atoms: list[_Atom]) -> list[_Atom]:
    result: list[_Atom] = []
    pending: list[_Atom] = []
    for atom in atoms:
        if pending and atom.heading_path != pending[0].heading_path:
            result.append(_merge_atoms(pending))
            pending = []
        if len(atom.content.strip()) < _SMALL_ATOM_CHARS:
            pending.append(atom)
            continue
        if pending:
            result.append(_merge_atoms([*pending, atom]))
            pending = []
        else:
            result.append(atom)
    if pending:
        if result and result[-1].heading_path == pending[0].heading_path:
            result[-1] = _merge_atoms([result[-1], *pending])
        else:
            result.append(_merge_atoms(pending))
    return result


def _merge_atoms(atoms: list[_Atom]) -> _Atom:
    return _Atom(
        content="\n\n".join(atom.content for atom in atoms),
        heading_path=atoms[0].heading_path,
        start_line=atoms[0].start_line,
        end_line=atoms[-1].end_line,
        kind=atoms[-1].kind,
        complete=True,
    )


def _split_atom(atom: _Atom, limit: int) -> list[_Atom]:
    if len(atom.content) <= limit:
        return [atom]
    if atom.kind == "code":
        return _split_code_atom(atom, limit)
    if atom.kind == "table":
        return _split_table_atom(atom, limit)
    return _split_lines(atom, limit)


def _split_lines(atom: _Atom, limit: int) -> list[_Atom]:
    lines = atom.content.splitlines()
    pieces: list[_Atom] = []
    current: list[str] = []
    current_start = atom.start_line

    def append_piece(piece_lines: list[str], start_line: int, end_line: int) -> None:
        content = "\n".join(piece_lines)
        if content:
            pieces.append(_Atom(content, atom.heading_path, start_line, end_line,
                                atom.kind, complete=False))

    for offset, line in enumerate(lines):
        line_number = atom.start_line + offset
        if len(line) > limit:
            if current:
                append_piece(current, current_start, line_number - 1)
                current = []
            for start in range(0, len(line), limit):
                append_piece([line[start:start + limit]], line_number, line_number)
            current_start = line_number + 1
            continue
        candidate = len(line) + sum(len(value) + 1 for value in current)
        if current and candidate > limit:
            append_piece(current, current_start, line_number - 1)
            current = []
            current_start = line_number
        current.append(line)
    if current:
        append_piece(current, current_start, atom.end_line)
    return pieces


def _split_code_atom(atom: _Atom, limit: int) -> list[_Atom]:
    lines = atom.content.splitlines()
    if len(lines) < 2:
        return _split_lines(atom, limit)
    opener = lines[0]
    marker = _FENCE.match(opener)
    if marker is None:
        return _split_lines(atom, limit)
    original_marker = marker.group(1)
    closer = original_marker
    closed = bool(re.match(
        rf"^\s{{0,3}}{re.escape(closer[0])}{{{len(closer)},}}\s*$", lines[-1]
    ))
    body = lines[1:-1] if closed else lines[1:]
    if not body:
        return _split_lines(atom, limit)
    context_opener = opener
    context_closer = closer
    if len(context_opener) + len(context_closer) + 3 >= limit:
        context_opener = original_marker[0] * 3
        context_closer = context_opener
    body_start = atom.start_line + 1
    body_atom = _Atom("\n".join(body), atom.heading_path, body_start,
                      atom.end_line - int(closed), atom.kind, False)
    inner_limit = max(1, limit - len(context_opener) - len(context_closer) - 2)
    pieces = _split_lines(body_atom, inner_limit)
    result: list[_Atom] = []
    for piece in pieces:
        start_line = atom.start_line
        end_line = atom.end_line if closed else piece.end_line
        result.append(_Atom(
            f"{context_opener}\n{piece.content}\n{context_closer}", atom.heading_path,
            start_line, end_line, atom.kind, False))
    return result


def _split_table_atom(atom: _Atom, limit: int) -> list[_Atom]:
    lines = atom.content.splitlines()
    context = lines[:2] if len(lines) >= 2 and re.match(
        r"^\s*\|?\s*:?-{3,}", lines[1]
    ) else lines[:1]
    data = lines[len(context):]
    if not data:
        return _split_lines(atom, limit)
    context_text = "\n".join(context)
    if len(context_text) + 2 >= limit:
        return _split_lines(atom, limit)
    inner_limit = max(1, limit - len(context_text) - 1)
    data_start = atom.start_line + len(context)
    data_atom = _Atom("\n".join(data), atom.heading_path, data_start,
                      atom.end_line, atom.kind, False)
    pieces = _split_lines(data_atom, inner_limit)
    return [
        _Atom(f"{context_text}\n{piece.content}", atom.heading_path,
              atom.start_line, piece.end_line, atom.kind, False)
        for piece in pieces
    ]


def _embedding_text(title: str, heading_path: tuple[str, ...], content: str) -> str:
    context = " > ".join((title, *heading_path))
    return f"{context}\n\n{content}"
