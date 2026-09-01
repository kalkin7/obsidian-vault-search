from __future__ import annotations

import json
import os
import re
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .document_fields import _frontmatter
from .tokenizer import BM25_POS

USER_DICT_MIN_COUNT = 10
COMPOUND_RE = re.compile(r"(?<![가-힣])([가-힣]{3,4})(?![가-힣])")
TOKENIZER_VERSION = "kiwi-pos-v2-userdict"
USER_WORDS_FILENAME = "kiwi_user_words.json"


def _term_values(value: Any) -> Iterable[str]:
    values = value if isinstance(value, list) else [value]
    for item in values:
        if isinstance(item, (str, int, float, bool)):
            term = str(item).strip()
            if term:
                yield term


def _entity_directories(vault_path: Path, wiki_folders: Iterable[str]) -> list[Path]:
    """Return configured and conventional vault-relative entity directories."""
    root = Path(vault_path).resolve()
    candidates: list[Path] = []
    for raw_folder in wiki_folders:
        raw = str(raw_folder).strip().replace("\\", "/")
        if not raw:
            continue
        configured = Path(raw)
        # Wiki folders are vault-relative. In particular, do not make a
        # machine-specific absolute path part of the user dictionary scan.
        if configured.is_absolute():
            continue
        directory = root / configured
        candidates.append(
            directory if directory.name.casefold() == "entities" else directory / "entities"
        )

    candidates.extend(root / relative for relative in ("8_Wiki/entities", "5_Wiki/entities"))

    result: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        normalized = candidate.resolve()
        if normalized in seen:
            continue
        try:
            normalized.relative_to(root)
        except ValueError:
            continue
        seen.add(normalized)
        if normalized.is_dir():
            result.append(normalized)
    return result


def entity_terms(vault_path: Path, wiki_folders: Iterable[str]) -> list[str]:
    """Read names and aliases from YAML entity notes only."""
    result: list[str] = []
    seen: set[str] = set()
    for directory in _entity_directories(vault_path, wiki_folders):
        for path in sorted(directory.rglob("*.md")):
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            metadata, _body = _frontmatter(path.as_posix(), text)
            if str(metadata.get("type", "")).strip().casefold() != "entity":
                continue
            for field in ("name", "aliases"):
                for term in _term_values(metadata.get(field)):
                    if term not in seen:
                        seen.add(term)
                        result.append(term)
    return result


def scan_compound_counts(texts: Iterable[str]) -> Counter[str]:
    """Count raw 3–4-Hangul compounds without tokenizing the source first."""
    counts: Counter[str] = Counter()
    for text in texts:
        if isinstance(text, str):
            counts.update(COMPOUND_RE.findall(text))
    return counts


def select_auto_terms(
    counts: Counter[str], kiwi: Any, min_count: int = USER_DICT_MIN_COUNT
) -> list[str]:
    """Select frequent compounds Kiwi currently splits into useful noun pieces."""
    selected: list[str] = []
    for word, count in sorted(counts.items()):
        if count < min_count:
            continue
        try:
            pieces = [
                token
                for token in kiwi.tokenize(word)
                if token.tag in BM25_POS and len(token.form) > 1
            ]
        except Exception:
            continue
        if len(pieces) >= 2:
            selected.append(word)
    return selected


def apply_terms(kiwi: Any, terms: Iterable[str]) -> None:
    """Install valid, unique user words as proper nouns."""
    seen: set[str] = set()
    for raw_term in terms:
        if not isinstance(raw_term, str):
            continue
        term = raw_term.strip()
        if len(term) <= 1 or term in seen:
            continue
        seen.add(term)
        kiwi.add_user_word(term, "NNP")


def _clean_saved_terms(terms: Any) -> list[str]:
    if not isinstance(terms, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for raw_term in terms:
        if not isinstance(raw_term, str):
            continue
        term = raw_term.strip()
        if len(term) <= 1 or term in seen:
            continue
        seen.add(term)
        result.append(term)
    return result


def load_saved(path: Path) -> tuple[list[str], list[str]]:
    """Load the persisted entity and auto word lists, ignoring count ledgers."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return [], []
    if not isinstance(payload, dict):
        return [], []
    return _clean_saved_terms(payload.get("entity")), _clean_saved_terms(payload.get("auto"))


def save_saved(path: Path, entity: Iterable[str], auto: Iterable[str]) -> None:
    """Persist only the selected word lists, never compound occurrence counts."""
    payload = {
        "entity": _clean_saved_terms(list(entity)),
        "auto": _clean_saved_terms(list(auto)),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def prepare_for_search(kiwi: Any, config: Any) -> None:
    """Apply live entity words and the previous full-rebuild auto list."""
    live_entities = entity_terms(config.vault_path, config.wiki_folders)
    _saved_entities, saved_auto = load_saved(config.data_dir / USER_WORDS_FILENAME)
    apply_terms(kiwi, [*live_entities, *saved_auto])


def prepare_for_full_rebuild(kiwi: Any, config: Any, texts: list[str]) -> None:
    """Select and save this snapshot's auto words before any index tokenization."""
    live_entities = entity_terms(config.vault_path, config.wiki_folders)
    counts = scan_compound_counts(texts)
    selected_auto = select_auto_terms(counts, kiwi)

    # initialize() has already applied the prior auto list to this Kiwi. Keep a
    # previously selected word when it still meets this snapshot's frequency
    # threshold; otherwise a user word would hide its own two-piece baseline
    # during the next full rebuild's selection pass.
    _saved_entities, saved_auto = load_saved(config.data_dir / USER_WORDS_FILENAME)
    retained_auto = [
        word for word in saved_auto if counts.get(word, 0) >= USER_DICT_MIN_COUNT
    ]
    auto = sorted(set(selected_auto).union(retained_auto))
    save_saved(config.data_dir / USER_WORDS_FILENAME, live_entities, auto)
    apply_terms(kiwi, [*live_entities, *auto])
