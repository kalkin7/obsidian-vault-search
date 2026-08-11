from vault_search.protocol import PROTOCOL_VERSION


def test_protocol_version_is_stable():
    assert PROTOCOL_VERSION == 1
