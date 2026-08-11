from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Any

from .tokenizer import tokenize

HEADING_RE = re.compile(r"(?m)^#{1,3}\s+(.+?)\s*$")


def title_tokens(file_path: str, text: str, kiwi: Any) -> tuple[list[str], list[str], list[str]]:
    """Return tokenized basename, directory, and level 1-3 headings."""
    path = PurePosixPath(file_path)
    basename = path.stem.replace("_", " ").replace("-", " ")
    directory = " ".join(part.replace("_", " ").replace("-", " ") for part in path.parent.parts)
    headings = " ".join(match.group(1) for match in HEADING_RE.finditer(text))
    return tokenize(basename, kiwi), tokenize(directory, kiwi), tokenize(headings, kiwi)
