import json
from pathlib import Path

from kiwipiepy import Kiwi

from vault_search.config import SearchConfig
from vault_search.index_metadata import expected_metadata
from vault_search.kiwi_user_dict import (
    TOKENIZER_VERSION,
    entity_terms,
    prepare_for_full_rebuild,
    prepare_for_search,
)
from vault_search.tokenizer import tokenize


def _config(vault: Path) -> SearchConfig:
    return SearchConfig(
        vault_path=vault,
        data_dir=vault / "data",
        wiki_folders=["8_Wiki"],
    )


def _assert_sentence_tokens(kiwi: Kiwi) -> None:
    cases = {
        "염화칼슘 자재피아 견적 2,833,000원": {"염화칼슘", "자재피아", "견적"},
        "자재피아에": {"자재피아"},
        "자재 구매": {"자재", "구매"},
        "옥상방수공사실시": {"옥상", "방수", "공사", "실시"},
        "자체보수공사": {"자체", "보수", "공사"},
        "보수공사했음": {"보수", "공사"},
    }
    for sentence, expected in cases.items():
        actual = tokenize(sentence, kiwi)
        assert expected.issubset(actual), (sentence, actual)

    combined = tokenize("염화칼슘 자재피아 견적 2,833,000원", kiwi)
    assert "자재" not in combined
    assert "피아" not in combined
    assert "염화" not in combined
    assert "칼슘" not in combined
    assert "옥상방수공사실시" not in tokenize("옥상방수공사실시", kiwi)


def test_full_rebuild_selects_entities_and_sentence_compounds(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    entity_dir = vault / "8_Wiki" / "entities"
    entity_dir.mkdir(parents=True)
    (entity_dir / "업체_자재피아.md").write_text(
        "---\n"
        "type: entity\n"
        "name: 자재피아\n"
        "aliases: [자재피아]\n"
        "---\n"
        "업체 엔티티\n",
        encoding="utf-8",
    )
    # An issue note in the same directory must not become an entity term.
    (entity_dir / "이슈_염화칼슘.md").write_text(
        "---\n"
        "type: issue\n"
        "name: 염화칼슘\n"
        "---\n"
        "이슈\n",
        encoding="utf-8",
    )
    note = vault / "2_Notes" / "제설제.md"
    note.parent.mkdir(parents=True)
    note_text = " ".join(["염화칼슘"] * 10)
    note.write_text(note_text, encoding="utf-8")

    config = _config(vault)
    kiwi = Kiwi()
    prepare_for_full_rebuild(
        kiwi,
        config,
        [
            (entity_dir / "업체_자재피아.md").read_text(encoding="utf-8"),
            (entity_dir / "이슈_염화칼슘.md").read_text(encoding="utf-8"),
            note_text,
        ],
    )

    assert entity_terms(vault, config.wiki_folders) == ["자재피아"]
    _assert_sentence_tokens(kiwi)

    saved_path = config.data_dir / "kiwi_user_words.json"
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    assert set(saved) == {"entity", "auto"}
    assert saved["entity"] == ["자재피아"]
    assert saved["auto"] == ["염화칼슘"]
    assert all("count" not in key.casefold() for key in saved)

    # Incremental/search startup reuses the saved auto list rather than
    # rescanning note text; live entity discovery still supplies the entity.
    note.unlink()
    search_kiwi = Kiwi()
    prepare_for_search(search_kiwi, config)
    _assert_sentence_tokens(search_kiwi)


def test_metadata_uses_user_dictionary_tokenizer_version(tmp_path: Path) -> None:
    metadata = expected_metadata(_config(tmp_path), 768)
    assert TOKENIZER_VERSION == "kiwi-pos-v2-userdict"
    assert metadata["tokenizer_version"] == TOKENIZER_VERSION
