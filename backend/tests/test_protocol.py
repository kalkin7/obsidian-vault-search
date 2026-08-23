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


def test_validate_mcp_secrets_params_with_http_urls():
    cleaned = validate_mcp_secrets_params(
        {
            "servers": {"s1": {"TOKEN": "secret"}},
            "http_urls": {"s2": "https://mcp.example.com/mcp?token=xyz"},
        }
    )
    assert cleaned["servers"] == {"s1": {"TOKEN": "secret"}}
    assert cleaned["http_urls"] == {"s2": "https://mcp.example.com/mcp?token=xyz"}

    # http_urls only
    cleaned_http_only = validate_mcp_secrets_params(
        {"http_urls": {"s2": "https://mcp.example.com/mcp"}}
    )
    assert cleaned_http_only["servers"] == {}
    assert cleaned_http_only["http_urls"] == {"s2": "https://mcp.example.com/mcp"}

    # Oversized URL rejected
    with pytest.raises(ProtocolError, match="at most 2048 characters"):
        validate_mcp_secrets_params({"http_urls": {"s2": "https://" + "a" * 2050}})

    # Invalid URL scheme rejected
    with pytest.raises(ProtocolError, match="absolute http or https URL"):
        validate_mcp_secrets_params({"http_urls": {"s2": "ftp://example.com"}})

    # URL with control characters or whitespace (leading, trailing, internal) rejected
    for ws_url in (
        " https://example.com/mcp",
        "https://example.com/mcp ",
        "\thttps://example.com/mcp",
        "https://example.com/mcp\n",
        "https://example.com/mcp token=123",
        "https://example.com/mcp\ntoken=123",
    ):
        with pytest.raises(ProtocolError, match="whitespace or control characters") as exc_info:
            validate_mcp_secrets_params({"http_urls": {"s2": ws_url}})
        # Error must never echo the input URL
        assert "token=123" not in str(exc_info.value)
        assert ws_url not in str(exc_info.value)

    # Valid URL schemes: uppercase, IPv6 with port
    valid_urls = [
        "HTTPS://EXAMPLE.COM/MCP?TOKEN=123",
        "HTTP://LOCALHOST:8080/MCP",
        "http://[::1]:8080/mcp",
        "https://[2001:db8::1]:9000/api",
    ]
    for v_url in valid_urls:
        res = validate_mcp_secrets_params({"http_urls": {"s2": v_url}})
        assert res["http_urls"]["s2"] == v_url

    # URL without hostname rejected
    with pytest.raises(ProtocolError, match="hostname"):
        validate_mcp_secrets_params({"http_urls": {"s2": "https://"}})

    # Server ID with control chars or too long
    with pytest.raises(ProtocolError, match="control characters"):
        validate_mcp_secrets_params({"servers": {"bad\nid": {}}})
    with pytest.raises(ProtocolError, match="1-64 characters"):
        validate_mcp_secrets_params({"servers": {"s" * 65: {}}})

    # Server count limits: 20 accept, 21 reject
    assert len(validate_mcp_secrets_params({"servers": {f"s{i}": {} for i in range(20)}})["servers"]) == 20
    with pytest.raises(ProtocolError, match="servers count exceeds limit of 20"):
        validate_mcp_secrets_params({"servers": {f"s{i}": {} for i in range(21)}})

    # HTTP URL count limits: 20 accept, 21 reject
    assert len(validate_mcp_secrets_params({"http_urls": {f"s{i}": "https://example.com" for i in range(20)}})["http_urls"]) == 20
    with pytest.raises(ProtocolError, match="http_urls count exceeds limit of 20"):
        validate_mcp_secrets_params({"http_urls": {f"s{i}": "https://example.com" for i in range(21)}})

    # Server union count limit: 11 stdio + 10 http = 21 unique servers -> reject
    with pytest.raises(ProtocolError, match="total server count exceeds limit of 20"):
        validate_mcp_secrets_params({
            "servers": {f"stdio_{i}": {} for i in range(11)},
            "http_urls": {f"http_{i}": "https://example.com" for i in range(10)},
        })

    # Same server in both is counted once in union (10 servers duplicated across both = 10 union)
    assert len(validate_mcp_secrets_params({
        "servers": {f"s{i}": {} for i in range(10)},
        "http_urls": {f"s{i}": "https://example.com" for i in range(10)},
    })["servers"]) == 10

    # Env count limits: 32 accept, 33 reject
    assert len(validate_mcp_secrets_params({"servers": {"s1": {f"ENV_{i}": "val" for i in range(32)}}})["servers"]["s1"]) == 32
    with pytest.raises(ProtocolError, match="env count for server exceeds limit of 32"):
        validate_mcp_secrets_params({"servers": {"s1": {f"ENV_{i}": "val" for i in range(33)}}})

    # Env name with control characters
    with pytest.raises(ProtocolError, match="control characters"):
        validate_mcp_secrets_params({"servers": {"s1": {"BAD\nNAME": "val"}}})

    # 32 KiB payload size boundary
    # Construct payload just below 32 KiB
    big_val = "x" * 7000
    res_32k = validate_mcp_secrets_params({
        "servers": {
            "s1": {"V1": big_val, "V2": big_val, "V3": big_val, "V4": big_val}
        }
    })
    assert len(res_32k["servers"]["s1"]["V1"]) == 7000

    # Exceed 32 KiB total payload bytes
    with pytest.raises(ProtocolError, match="exceeds 32 KiB"):
        validate_mcp_secrets_params({
            "servers": {
                f"s{i}": {f"KEY_{j}": "a" * 1500 for j in range(2)} for i in range(15)
            }
        })

    # Empty payloads
    assert validate_mcp_secrets_params({"servers": {}}) == {"servers": {}, "http_urls": {}}
    assert validate_mcp_secrets_params({"http_urls": {}}) == {"servers": {}, "http_urls": {}}
    with pytest.raises(ProtocolError, match="'servers' or 'http_urls' object is required"):
        validate_mcp_secrets_params({})


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
