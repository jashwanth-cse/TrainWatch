"""Pre-push verification and automated remediation guardrail for TrainWatch."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
MOBILE_DIR = ROOT_DIR / "mobile"


def _log(msg: str) -> None:
    print(f"[pre-push] {msg}", flush=True)


def _find_backend_python() -> str:
    """Locate the Python executable inside backend/.venv or fallback to sys.executable."""
    windows_venv = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    unix_venv = BACKEND_DIR / ".venv" / "bin" / "python"
    if windows_venv.is_file():
        return str(windows_venv)
    if unix_venv.is_file():
        return str(unix_venv)
    return sys.executable


def _run_cmd(args: list[str], cwd: Path) -> int:
    """Execute a subprocess command, streaming stdout/stderr."""
    cmd_str = " ".join(args)
    _log(f"Running: {cmd_str}")
    proc = subprocess.run(args, cwd=str(cwd))
    return proc.returncode


def _sync_uv_lockfile() -> bool:
    """Ensure backend/uv.lock records the exact version declared in pyproject.toml."""
    pyproject_file = BACKEND_DIR / "pyproject.toml"
    uv_lock_file = BACKEND_DIR / "uv.lock"

    if not pyproject_file.is_file() or not uv_lock_file.is_file():
        return True

    pyproject_content = pyproject_file.read_text(encoding="utf-8")
    ver_match = re.search(r'version\s*=\s*"([^"]+)"', pyproject_content)
    if not ver_match:
        return True
    target_ver = ver_match.group(1)

    lock_content = uv_lock_file.read_text(encoding="utf-8")
    pkg_pattern = re.compile(
        r'(\[\[package\]\]\s+name\s*=\s*"trainwatch"\s+version\s*=\s*)"([^"]+)"',
        re.MULTILINE,
    )
    current_match = pkg_pattern.search(lock_content)
    if current_match and current_match.group(2) != target_ver:
        _log(
            f"Lockfile version mismatch: {current_match.group(2)} -> {target_ver}. Synchronizing..."
        )
        uv_bin = shutil.which("uv")
        if uv_bin:
            _run_cmd([uv_bin, "lock"], cwd=BACKEND_DIR)
        else:
            new_content = pkg_pattern.sub(rf'\g<1>"{target_ver}"', lock_content)
            uv_lock_file.write_text(new_content, encoding="utf-8")
        _log("uv.lock successfully updated.")
        return True
    return True


def _run_backend_pipeline(py_bin: str) -> bool:
    """Run secret check, code auto-formatting, lint fixes, type checking, and tests."""
    _log("--- Starting Backend Quality Pipeline ---")

    # 1. Secret check
    secret_script = ROOT_DIR / "scripts" / "check_secrets.py"
    if secret_script.is_file():
        rc = _run_cmd([py_bin, str(secret_script)], cwd=ROOT_DIR)
        if rc != 0:
            _log("Secret safety scan failed.")
            return False

    # 2. Lockfile check and sync
    _sync_uv_lockfile()

    # 3. Auto-format code
    _log("Applying code formatting via ruff...")
    _run_cmd([py_bin, "-m", "ruff", "format", ".", "../scripts"], cwd=BACKEND_DIR)

    # 4. Auto-fix linting issues
    _log("Applying auto-fixable linting rules via ruff...")
    _run_cmd(
        [py_bin, "-m", "ruff", "check", "--fix", ".", "../scripts"],
        cwd=BACKEND_DIR,
    )

    # 5. Type checking with mypy
    _log("Running static type checking via mypy...")
    rc = _run_cmd([py_bin, "-m", "mypy", "src", "tests", "../scripts"], cwd=BACKEND_DIR)
    if rc != 0:
        _log("Mypy type checking failed. Please resolve the type errors.")
        return False

    # 6. Unit tests with pytest
    _log("Running unit test suite with coverage via pytest...")
    rc = _run_cmd([py_bin, "-m", "pytest", "-q"], cwd=BACKEND_DIR)
    if rc != 0:
        _log("Pytest test suite failed.")
        return False

    _log("Backend quality pipeline passed cleanly.")
    return True


def _run_mobile_pipeline() -> bool:
    """Run mobile unit tests, TypeScript compiler, and Expo linter."""
    if not (MOBILE_DIR / "package.json").is_file():
        return True

    _log("--- Starting Mobile Quality Pipeline ---")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"

    # 1. Mobile unit tests
    _log("Running mobile unit test suite...")
    rc = _run_cmd([npm_cmd, "test", "--", "--watchAll=false"], cwd=MOBILE_DIR)
    if rc != 0:
        _log("Mobile unit tests failed.")
        return False

    # 2. TypeScript type check
    _log("Running mobile TypeScript type checking...")
    rc = _run_cmd([npx_cmd, "tsc", "--noEmit"], cwd=MOBILE_DIR)
    if rc != 0:
        _log("Mobile TypeScript compilation failed.")
        return False

    # 3. Expo linter
    _log("Running mobile Expo linter...")
    rc = _run_cmd([npm_cmd, "run", "lint"], cwd=MOBILE_DIR)
    if rc != 0:
        _log("Mobile lint check failed.")
        return False

    _log("Mobile quality pipeline passed cleanly.")
    return True


def _stage_auto_fixes() -> None:
    """Stage any files modified by auto-formatters or lockfile synchronizers."""
    diff_proc = subprocess.run(
        ["git", "diff", "--name-only"],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    changed = [f.strip() for f in diff_proc.stdout.splitlines() if f.strip()]
    if changed:
        _log(f"Auto-fixed files detected: {', '.join(changed)}")
        subprocess.run(["git", "add", "-u"], cwd=str(ROOT_DIR))
        _log(
            "Auto-fixed files have been staged with 'git add -u'. "
            "Please amend your commit ('git commit --amend --no-edit') "
            "or commit them to include in your push."
        )


def main() -> int:
    """Main pre-push entry point."""
    _log("TrainWatch automated pre-push guardrail started.")
    py_bin = _find_backend_python()

    if not _run_backend_pipeline(py_bin):
        _log("ABORTING PUSH: Backend verification checks failed.")
        return 1

    if not _run_mobile_pipeline():
        _log("ABORTING PUSH: Mobile verification checks failed.")
        return 1

    _stage_auto_fixes()
    _log("All local verification checks passed. Push authorized!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
