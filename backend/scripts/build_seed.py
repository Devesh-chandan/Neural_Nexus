"""
Build seed CSV files for all whitelist underlyings.
Run once (requires internet). Commit data/seed/*.csv so demos work offline.

Usage:
    cd backend
    python scripts/build_seed.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

# Allow importing from the backend app directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from app.core.config import get_underlyings
from app.market.provider import download_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("build_seed")

SEED_DIR = Path(__file__).resolve().parent.parent / "data" / "seed"
START_DATE = "2008-01-01"
SYNTHETIC_FLAG = SEED_DIR / "_synthetic.txt"


def build_seed() -> None:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    underlyings = get_underlyings()
    failed = []

    for key, meta in underlyings.items():
        ticker = meta["ticker"]
        out_path = SEED_DIR / f"{key}.csv"
        logger.info("Downloading %s (%s)...", key, ticker)
        try:
            df = download_history(ticker, START_DATE)
            df.to_csv(out_path)
            logger.info("  ✓ Saved %d rows → %s", len(df), out_path.name)
        except Exception as exc:
            logger.error("  ✗ Failed for %s: %s", key, exc)
            failed.append(key)
            _write_synthetic(key, out_path)

    if failed:
        SYNTHETIC_FLAG.write_text(
            f"Synthetic placeholders generated for: {', '.join(failed)}\n"
            "Re-run build_seed.py with internet access to replace them.\n"
        )
        logger.warning(
            "Synthetic seed created for %d underlyings: %s. "
            "Re-run with internet access.",
            len(failed), failed,
        )
    else:
        if SYNTHETIC_FLAG.exists():
            SYNTHETIC_FLAG.unlink()
        logger.info("All seed files built successfully.")


def _write_synthetic(key: str, path: Path) -> None:
    """Generate a synthetic placeholder with 15 years of daily random-walk data."""
    import numpy as np

    rng = np.random.default_rng(abs(hash(key)) % (2**31))
    n = 252 * 15
    log_ret = rng.normal(0.0003, 0.012, n)
    prices = 1000.0 * np.exp(np.cumsum(log_ret))
    dates = pd.bdate_range("2008-01-02", periods=n)
    df = pd.DataFrame({"close": prices}, index=dates)
    df.index.name = "date"
    df.to_csv(path)
    logger.info(
        "  ↳ Synthetic placeholder written for %s (%d rows, seed_synthetic=true)", key, n
    )


if __name__ == "__main__":
    build_seed()
