"""Regression tests for repository secret-detection patterns."""

from scripts.check_secrets import PATTERNS


def test_credential_assignment_detects_quoted_json_key() -> None:
    """Treat a quoted JSON credential property as an assignment."""
    key = "pass" + "word"
    value = "actual-service-password"
    payload = '{"' + key + '": "' + value + '"}'

    match = PATTERNS["credential assignment"].search(payload)

    assert match is not None
    assert match.group(1) == value
