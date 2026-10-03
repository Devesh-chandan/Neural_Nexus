"""Save every run as a JSON file (runs/<run_id>.json) so it can be reloaded for audit."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional

_RUN_ID = re.compile(r"^sim_[0-9a-f]{6,64}$")


def save_run(result: Dict[str, Any], runs_dir: str = "runs") -> str:
    os.makedirs(runs_dir, exist_ok=True)
    path = os.path.join(runs_dir, f"{result['run_id']}.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)
    return path


def load_run(run_id: str, runs_dir: str = "runs") -> Optional[Dict[str, Any]]:
    if not _RUN_ID.match(run_id or ""):
        return None
    path = os.path.join(runs_dir, f"{run_id}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
