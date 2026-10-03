"""
Seed data loader – reads bundled CSV files from data/seed/.
These are committed to the repo so the demo works offline.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import pandas as pd

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def load_seed(key: str) -> Optional[pd.DataFrame]:
    """
    Load seed CSV for *key* if it exists.
    Returns DataFrame with 'close' column and DatetimeIndex, or None.
    """
    settings = get_settings()
    path = settings.seed_dir / f"{key}.csv"

    if not path.exists():
        logger.debug("No seed file for %s at %s", key, path)
        return None

    try:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        if "close" not in df.columns:
            # Try renaming common variants
            col_map = {c: "close" for c in df.columns if c.lower() == "close"}
            df.rename(columns=col_map, inplace=True)
        if "close" not in df.columns:
            logger.warning("Seed file %s has no 'close' column; columns: %s", key, list(df.columns))
            return None
        df.index = pd.to_datetime(df.index).normalize()
        df = df[["close"]].copy()
        df = df[~df.index.duplicated(keep="last")]
        df.sort_index(inplace=True)
        logger.info("Loaded seed data for %s (%d rows)", key, len(df))
        return df
    except Exception as exc:
        logger.error("Failed to load seed for %s: %s", key, exc)
        return None
