"""Run the CLI bridge validator inside Hermes' managed Python runtime."""

from __future__ import annotations

import runpy
import sys


sys.path.insert(0, "/root/.hermes/hermes-agent")
import hermes_bootstrap  # noqa: F401,E402 -- activates Hermes' managed dependencies

sys.argv = ["validate-cli-bridge.py", "/tmp/cli_bridge.py"]
runpy.run_path("/tmp/validate-cli-bridge.py", run_name="__main__")
