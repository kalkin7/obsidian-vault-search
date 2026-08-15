import pytest

from vault_search.protocol import PROTOCOL_VERSION, ProtocolError, validate_answer_params


def test_protocol_version_is_stable():
    assert PROTOCOL_VERSION == 1


def test_answer_contract_is_normalized_and_bounded():
    value = validate_answer_params({"query": " 질문 ", "top_k": 12, "conversation": []})
    assert value["query"] == "질문"
    assert value["max_context_chars"] == 24000


@pytest.mark.parametrize("params", [
    {"query": ""},
    {"query": "x", "top_k": 13},
    {"query": "x", "conversation": [{"role": "user", "content": "x"}]},
])
def test_answer_contract_rejects_invalid_params(params):
    with pytest.raises(ProtocolError):
        validate_answer_params(params)
