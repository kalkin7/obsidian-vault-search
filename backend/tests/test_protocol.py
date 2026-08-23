import pytest

from vault_search.protocol import (
    PROTOCOL_VERSION,
    ProtocolError,
    validate_answer_cancel_params,
    validate_answer_continue_params,
    validate_answer_params,
    validate_answer_start_params,
    validate_mcp_secrets_params,
)


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


# ---------------------------------------------------------------------------
# Stateful answer protocol (plan §11)
# ---------------------------------------------------------------------------


def test_answer_start_normalizes_query_and_conversation():
    value = validate_answer_start_params(
        {
            "query": " 질문 ",
            "conversation": [
                {"role": "user", "content": "이전"},
                {"role": "assistant", "content": "응답"},
            ],
            "session_allowed_tools": ["mcp__a__b"],
            "client_conversation_id": "conv-1",
        }
    )
    assert value["query"] == "질문"
    assert len(value["conversation"]) == 2
    assert value["session_allowed_tools"] == ["mcp__a__b"]
    assert value["client_conversation_id"] == "conv-1"


def test_answer_start_rejects_bad_shapes():
    for params in (
        {},
        {"query": ""},
        {"query": "x" * 8001},
        {
            "query": "q",
            "conversation": [
                {"role": "assistant", "content": "x"},
            ],
        },
        {"query": "q", "session_allowed_tools": "not-a-list"},
    ):
        with pytest.raises(ProtocolError):
            validate_answer_start_params(params)


def test_answer_continue_requires_full_decision_coverage():
    value = validate_answer_continue_params(
        {
            "run_id": " run-1 ",
            "decisions": [{"call_id": "c1", "decision": "allow_once"}],
        }
    )
    assert value["run_id"] == "run-1"
    for params in (
        {"run_id": "", "decisions": []},
        {"run_id": "r"},
        {"run_id": "r", "decisions": []},
        {
            "run_id": "r",
            "decisions": [
                {"call_id": "c1", "decision": "allow_once"},
                {"call_id": "c1", "decision": "reject"},
            ],
        },
        {"run_id": "r", "decisions": [{"call_id": "c1", "decision": "always"}]},
        {"run_id": "r", "decisions": [{"decision": "allow_once"}]},
    ):
        with pytest.raises(ProtocolError):
            validate_answer_continue_params(params)


def test_answer_cancel_requires_run_id():
    assert validate_answer_cancel_params({"run_id": " r "}) == {"run_id": "r"}
    with pytest.raises(ProtocolError):
        validate_answer_cancel_params({})
    with pytest.raises(ProtocolError):
        validate_answer_cancel_params({"run_id": ""})


def test_mcp_secrets_bounds_and_shape():
    value = validate_mcp_secrets_params(
        {"servers": {"srv-1": {"TOKEN": "abc"}}}
    )
    assert value["servers"] == {"srv-1": {"TOKEN": "abc"}}
    with pytest.raises(ProtocolError):
        validate_mcp_secrets_params({"nope": {}})
    with pytest.raises(ProtocolError):
        validate_mcp_secrets_params({"servers": {"s": {"n": 5}}})
    with pytest.raises(ProtocolError):
        validate_mcp_secrets_params({"servers": {"s": {"n": "v" * (8 * 1024 + 1)}}})
    with pytest.raises(ProtocolError):
        validate_mcp_secrets_params(
            {"servers": {"s": {"n" * 129: "v"}}}
        )
    # Aggregate payload bound: many small values exceeding 32 KiB.
    big = {
        "servers": {
            f"s{i}": {f"N{j}": "x" * 4000 for j in range(9)} for i in range(10)
        }
    }
    with pytest.raises(ProtocolError):
        validate_mcp_secrets_params(big)


# ---------------------------------------------------------------------------
# Additive client-supplied run id (fix §3)
# ---------------------------------------------------------------------------


def test_answer_start_accepts_client_run_id():
    params = validate_answer_start_params(
        {"query": "질문", "run_id": "abc-DEF_12345"}
    )
    assert params["run_id"] == "abc-DEF_12345"


def test_answer_start_run_id_optional():
    params = validate_answer_start_params({"query": "질문"})
    assert params["run_id"] is None


def test_answer_start_rejects_invalid_run_id():
    for bad in ("short", "bad id!", "한글아이디", "x" * 65):
        with pytest.raises(ProtocolError):
            validate_answer_start_params({"query": "질문", "run_id": bad})
