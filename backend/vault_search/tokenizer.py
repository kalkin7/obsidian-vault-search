from __future__ import annotations

import re
from typing import Any

BM25_POS = frozenset({"NNG", "NNP", "NNB", "NR", "VV", "VA", "XR", "SL", "SN"})


def tokenize(text: str, kiwi: Any) -> list[str]:
    try:
        tokens = kiwi.tokenize(text, normalize_coda=True)
        result = [token.form.lower() for token in tokens
                  if token.tag in BM25_POS and len(token.form) > 1]
        if result:
            return result
    except Exception:
        pass
    return [word.lower() for word in re.findall(r"[\w가-힣]+", text) if len(word) > 1]
