"""Makes module3_suitability_engine's `suitability` module importable from the backend.

Like module2 (see app/simulation/bridge.py), module3 is not pip-installed and is reused
as-is rather than copied, so its folder is added to sys.path here.
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]  # backend/app/assessment -> repo root
MODULE3_ROOT = _REPO_ROOT / "module3_suitability_engine"

_module3_root_str = str(MODULE3_ROOT)
if _module3_root_str not in sys.path:
    sys.path.insert(0, _module3_root_str)

from suitability import RULES_V1, SuitabilityEngine  # noqa: E402

__all__ = ["RULES_V1", "SuitabilityEngine", "MODULE3_ROOT"]
