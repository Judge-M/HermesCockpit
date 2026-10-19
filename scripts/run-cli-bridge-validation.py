"""Run the CLI bridge validator inside Hermes' managed Python runtime."""

from __future__ import annotations

import os
from pathlib import Path
import runpy
import sys


repo_root = Path(__file__).resolve().parent.parent
hermes_source = Path(os.environ.get("HERMES_SOURCE", "/root/.hermes/hermes-agent"))
sys.path.insert(0, str(hermes_source))
import hermes_bootstrap  # noqa: F401,E402 -- activates Hermes' managed dependencies

validator = repo_root / "scripts" / "validate-cli-bridge.py"
bridge = repo_root / "server" / "judge-m-control-plane" / "dashboard" / "cli_bridge.py"
sys.argv = [str(validator), str(bridge)]
runpy.run_path(str(validator), run_name="__main__")
