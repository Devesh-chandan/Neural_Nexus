"""
Build seed CSV files for all whitelist underlyings.
Run once (requires internet). Commit data/seed/*.csv so demos work offline.

Only real downloaded prices are written. If a download fails, that underlying's
existing seed file is left untouched and the script exits non-zero; no
placeholder series is ever generated.

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

from app.core.config import get_underlyings
from app.market.provider import download_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("build_seed")

SEED_DIR = Path(__file__).resolve().parent.parent / "data" / "seed"
START_DATE = "2008-01-01"


def build_seed() -> int:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    failed = []

    for key, meta in get_underlyings().items():
        ticker = meta["ticker"]
        out_path = SEED_DIR / f"{key}.csv"
        logger.info("Downloading %s (%s)...", key, ticker)
        try:
            df = download_history(ticker, START_DATE)
            df.to_csv(out_path)
            logger.info("  ✓ Saved %d rows → %s", len(df), out_path.name)
        except Exception as exc:
            logger.error("  ✗ Failed for %s: %s (existing seed file kept)", key, exc)
            failed.append(key)

    if failed:
        logger.error("Could not refresh: %s. Re-run with internet access.", ", ".join(failed))
        return 1
    logger.info("All seed files built successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(build_seed())
