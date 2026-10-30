"""Verify rollout gating without calling Google Cloud."""

import json
import os
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("status,expected_exit", [("200", 0), ("503", 1), ("302", 1), ("000", 1)])
def test_deploy_probes_tag_before_shifting_traffic(
    tmp_path: Path, status: str, expected_exit: int
) -> None:
    script = Path(__file__).resolve().parents[3] / "deploy/staging/deploy.sh"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gcloud = bin_dir / "gcloud"
    gcloud.write_text(
        """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
p = pathlib.Path(os.environ['TEST_DIR'])
with (p / 'calls').open('a') as f: f.write(json.dumps(args) + '\\n')
if args[:3] == ['config', 'get-value', 'project']:
    print('test-project')
elif args[:2] == ['run', 'deploy']:
    tag = next(a.split('=', 1)[1] for a in args if a.startswith('--tag='))
    (p / 'tag').write_text(tag)
elif args[:3] == ['run', 'services', 'describe']:
    print(json.dumps({'status': {'latestReadyRevisionName': 'unrelated-revision', 'traffic': [
        {'tag': (p / 'tag').read_text(), 'revisionName': 'tested-revision',
         'url': 'https://tagged.example.invalid'}]}}))
"""
    )
    curl = bin_dir / "curl"
    curl.write_text('#!/bin/sh\nprintf \'%s\' "$TEST_STATUS"\n[ "$TEST_STATUS" != 000 ]\n')
    gcloud.chmod(0o755)
    curl.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "TEST_DIR": str(tmp_path),
        "TEST_STATUS": status,
        "GOOGLE_CLOUD_PROJECT": "test-project",
    }
    result = subprocess.run(
        ["bash", str(script)], env=env, capture_output=True, text=True, check=False
    )
    assert result.returncode == expected_exit, result.stderr
    calls = [json.loads(line) for line in (tmp_path / "calls").read_text().splitlines()]
    deploy = next(call for call in calls if call[:2] == ["run", "deploy"])
    assert "--no-traffic" in deploy and any(arg.startswith("--tag=") for arg in deploy)
    shifts = [call for call in calls if call[:3] == ["run", "services", "update-traffic"]]
    if status == "200":
        assert len(shifts) == 1 and "--to-revisions=tested-revision=100" in shifts[0]
    else:
        assert not shifts
