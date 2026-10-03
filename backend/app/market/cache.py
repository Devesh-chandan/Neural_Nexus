"""
Disk-based cache for market history (parquet files, 12-hour TTL).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import pandas as pd

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _cache_path(key: str) -> Path:
    settings = get_settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.cache_dir / f"{key}.parquet"


def _meta_path(key: str) -> Path:
    return _cache_path(key).with_suffix(".meta")


def load_cache(key: str) -> Optional[pd.DataFrame]:
    """Return cached DataFrame if it exists and is within TTL, else None."""
    path = _cache_path(key)
    meta = _meta_path(key)
    if not path.exists() or not meta.exists():
        return None

    try:
        saved_at = float(meta.read_text().strip())
    except Exception:
        return None

    settings = get_settings()
    if time.time() - saved_at > settings.cache_ttl_seconds:
        logger.debug("Cache expired for %s", key)
        return None

    try:
        df = pd.read_parquet(path)
        logger.debug("Cache hit for %s (%d rows)", key, len(df))
        return df
    except Exception as exc:
        logger.warning("Cache read failed for %s: %s", key, exc)
        return None


def save_cache(key: str, df: pd.DataFrame) -> None:
    """Persist DataFrame to disk cache."""
    path = _cache_path(key)
    meta = _meta_path(key)
    try:
        df.to_parquet(path)
        meta.write_text(str(time.time()))
        logger.debug("Saved cache for %s (%d rows)", key, len(df))
    except Exception as exc:
        logger.warning("Cache write failed for %s: %s", key, exc)
