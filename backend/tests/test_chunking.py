from vault_search.chunking import chunk_text, extract_content


def test_frontmatter_removed():
    text = "---\ntitle: test\n---\n\nThis is a sufficiently long paragraph for indexing."
    assert "title:" not in extract_content(text)
    chunks = chunk_text(text, 100, 10)
    assert len(chunks) == 1
    assert "sufficiently" in chunks[0]


def test_long_paragraph_split_with_overlap():
    text = "가나다라마바사아자차카타파하" * 20
    chunks = chunk_text(text, 100, 20)
    assert len(chunks) > 1
    assert all(len(chunk) <= 100 for chunk in chunks)
