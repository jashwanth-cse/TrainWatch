"""Regression tests for repository secret-detection patterns."""

from pathlib import Path

import pytest
from scripts import check_secrets
from scripts.check_secrets import PATTERNS


def test_credential_assignment_detects_quoted_json_key() -> None:
    """Treat a quoted JSON credential property as an assignment."""
    key = "pass" + "word"
    value = "actual-service-password"
    payload = '{"' + key + '": "' + value + '"}'

    match = PATTERNS["credential assignment"].search(payload)

    assert match is not None
    assert match.group(1) == value


@pytest.mark.parametrize(
    "credential",
    [
        *("gh" + kind + "_" + "A" * 36 for kind in "pousr"),
        "github" + "_pat_" + "A" * 22 + "_" + "b" * 59,
    ],
    ids=["personal", "oauth", "user", "server", "refresh", "fine-grained"],
)
def test_github_credential_outside_assignment_fails_scan(
    credential: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Reject GitHub credentials without exposing their values in diagnostics."""
    payload = "Authorization: Bearer " + credential
    assert PATTERNS["credential assignment"].search(payload) is None
    (tmp_path / "request.txt").write_text(payload, encoding="utf-8")
    monkeypatch.setattr(check_secrets, "ROOT", tmp_path)

    assert check_secrets.main() == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "Potential GitHub access credential: request.txt:1\n"
    assert credential not in captured.err


@pytest.mark.parametrize("quote", ["", "'", '"'])
@pytest.mark.parametrize("reference", ["${{ secrets.SONAR_TOKEN }}", "${{secrets.SONAR_TOKEN}}"])
def test_github_actions_secret_reference_passes_scan(
    quote: str,
    reference: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Allow references to externally stored secrets, including quoted YAML values."""
    key = "SONAR_" + "TOKEN"
    (tmp_path / "workflow.yml").write_text(f"{key}: {quote}{reference}{quote}\n", encoding="utf-8")
    monkeypatch.setattr(check_secrets, "ROOT", tmp_path)

    assert check_secrets.main() == 0
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize(
    "value",
    [
        "synthetic-literal-value",
        "$",
        "${{ secrets.SONAR_TOKEN }",
        "${{ secrets.SONAR_TOKEN }}suffix",
        "prefix${{ secrets.SONAR_TOKEN }}",
        "${{ secrets.SONAR_TOKEN }} extra-value",
        "${{ secrets.SONAR_TOKEN || 'synthetic-literal-value' }}",
        "${{ env.SONAR_TOKEN }}",
        "${{ secrets.SONAR_TOKEN }}'",
        '"${{ secrets.SONAR_TOKEN }}',
    ],
)
def test_literal_and_malformed_secret_values_fail_scan(
    value: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Keep literal assignments and non-reference expressions subject to detection."""
    key = "SONAR_" + "TOKEN"
    (tmp_path / "workflow.yml").write_text(f"{key}: {value}\n", encoding="utf-8")
    monkeypatch.setattr(check_secrets, "ROOT", tmp_path)

    assert check_secrets.main() == 1
    captured = capsys.readouterr()
    assert captured.err == "Potential credential assignment: workflow.yml:1\n"
    assert value not in captured.err


def test_github_reference_does_not_hide_known_credential(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A reference exemption must not suppress independent known-token detection."""
    key = "SONAR_" + "TOKEN"
    credential = "gh" + "p_" + "A" * 36
    reference = "${{ secrets." + credential + " }}"
    (tmp_path / "workflow.yml").write_text(f"{key}: {reference}\n", encoding="utf-8")
    monkeypatch.setattr(check_secrets, "ROOT", tmp_path)

    assert check_secrets.main() == 1
    captured = capsys.readouterr()
    assert captured.err == "Potential GitHub access credential: workflow.yml:1\n"
    assert credential not in captured.err
