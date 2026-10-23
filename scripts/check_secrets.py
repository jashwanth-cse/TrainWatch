"""Fail when repository text files contain common committed-secret patterns."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIPPED_DIRECTORIES = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".uv-cache",
    ".uv-python",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "htmlcov",
    "node_modules",
}
SKIPPED_FILES = {".coverage"}
TEXT_SUFFIXES = {
    "",
    ".cfg",
    ".env",
    ".ini",
    ".json",
    ".lock",
    ".md",
    ".py",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}
PLACEHOLDERS = {
    "example.invalid",
    "false",
    "placeholder",
    "replace_me",
}
PATTERNS = {
    "private key header": re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    "Google API key": re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    "GitHub access credential": re.compile(r"gh(?:p|o|u|s|r)_[0-9A-Za-z]{30,}"),
    "Slack access credential": re.compile(r"xox[baprs]-[0-9A-Za-z-]{20,}"),
    "credential assignment": re.compile(
        r"(?i)['\"]?(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|token)"
        r"['\"]?\s*[=:]\s*['\"]?([^\s,'\"#}{]+)"
    ),
}


def iter_text_files() -> list[Path]:
    """Return repository text files without traversing generated directories."""
    return sorted(
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and path.name not in SKIPPED_FILES
        and (path.suffix.lower() in TEXT_SUFFIXES or path.name.startswith(".env"))
        and not any(part in SKIPPED_DIRECTORIES for part in path.parts)
    )


def is_allowed_placeholder(match: re.Match[str]) -> bool:
    """Allow explicit non-secret sample values in documentation and templates."""
    if match.lastindex is None:
        return False
    value = match.group(1).strip().lower()
    return value in PLACEHOLDERS or value.startswith("https://example.invalid")


def main() -> int:
    """Scan repository files and return a process-friendly result code."""
    findings: list[tuple[Path, int, str]] = []
    for path in iter_text_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (FileNotFoundError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(lines, start=1):
            for label, pattern in PATTERNS.items():
                match = pattern.search(line)
                if match is not None and not is_allowed_placeholder(match):
                    findings.append((path.relative_to(ROOT), line_number, label))

    if findings:
        for path, line_number, label in findings:
            print(f"Potential {label}: {path}:{line_number}", file=sys.stderr)
        return 1

    print(f"Secret-safety scan passed ({len(iter_text_files())} text files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
