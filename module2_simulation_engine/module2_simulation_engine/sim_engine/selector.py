"""Pick 20 real past periods out of the full line-up (the locked selection rule).

Line up every past period from biggest fall to biggest rise, then fill slots:
  1  Worst ever         first in the line-up
  2  Best ever          last in the line-up
  3  10% drop           period that moved closest to -10%
  4  Sideways           among periods that ended within a small band of 0%, the calmest one
                        (smallest high-low swing); if none, the one closest to 0%
  5  Most recent        the latest complete period
  6-20 Spread           15 periods at equal gaps along the line-up, labelled by their move

Two picks must start at least 60 trading days apart; a clashing pick moves to the
nearest free period in the line-up. If history is too short, the gap is halved until
20 picks fit (or every available period is used). No randomness anywhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np

from .config import (DROP_TARGET, LABEL_BANDS, MATCH_TOLERANCE, N_SCENARIOS, N_SPREAD,
                     SIDEWAYS_BAND, SPACING_TRADING_DAYS)
from .windows import Windows

FIXED_ORDER = ("worst_ever", "best_ever", "drop_10", "sideways", "most_recent")


@dataclass
class Pick:
    kind: str     # worst_ever | best_ever | drop_10 | sideways | most_recent | spread
    w: int        # index into the Windows arrays
    label: str    # "Worst ever", "Fall", "Closest to a 10% drop", ...


def label_for_move(move: float, asset_class: str) -> str:
    flat, big = LABEL_BANDS[asset_class]
    if move <= -big:
        return "Big fall"
    if move < -flat:
        return "Fall"
    if move <= flat:
        return "Flat"
    if move <= big:
        return "Rise"
    return "Big rise"


class _Blocker:
    """Tracks which windows are too close (by start day) to an already chosen one."""

    def __init__(self, starts: np.ndarray, spacing: int):
        self.starts = starts
        self.spacing = spacing
        self.blocked = np.zeros(len(starts), dtype=bool)

    def free(self, w: int) -> bool:
        return not self.blocked[w]

    def take(self, w: int) -> None:
        lo = np.searchsorted(self.starts, self.starts[w] - self.spacing + 1, side="left")
        hi = np.searchsorted(self.starts, self.starts[w] + self.spacing - 1, side="right")
        self.blocked[lo:hi] = True
        self.blocked[w] = True

    def first_free(self, candidates: Iterable[int]) -> Optional[int]:
        for w in candidates:
            if not self.blocked[w]:
                return int(w)
        return None


def _around(center: int, n: int) -> Iterable[int]:
    """center, center+1, center-1, center+2, center-2, ... within [0, n)."""
    yield center
    for d in range(1, n):
        moved = False
        if center + d < n:
            moved = True
            yield center + d
        if center - d >= 0:
            moved = True
            yield center - d
        if not moved:
            return


def _pick_once(win: Windows, swing: Callable[[int], float], asset_class: str,
               spacing: int, n_spread: int) -> List[Pick]:
    n = len(win)
    starts, move = win.start, win.move
    order = np.lexsort((starts, move))            # the line-up: by move, ties by date
    blocker = _Blocker(starts, spacing)
    picks: List[Pick] = []

    def add(kind: str, w: Optional[int], label: str) -> None:
        if w is not None:
            blocker.take(w)
            picks.append(Pick(kind, w, label))

    add("worst_ever", blocker.first_free(order), "Worst ever")
    add("best_ever", blocker.first_free(order[::-1]), "Best ever")

    w = blocker.first_free(np.lexsort((starts, np.abs(move - DROP_TARGET))))
    if w is not None:
        close = abs(move[w] - DROP_TARGET) <= MATCH_TOLERANCE
        add("drop_10", w, "10% drop" if close else "Closest to a 10% drop")

    band = SIDEWAYS_BAND[asset_class]
    in_band = np.nonzero(np.abs(move) <= band)[0]
    w = None
    if len(in_band):
        swings = np.array([swing(int(i)) for i in in_band])
        w = blocker.first_free(in_band[np.lexsort((starts[in_band], np.abs(move[in_band]), swings))])
    if w is None:
        w = blocker.first_free(np.lexsort((starts, np.abs(move))))
    if w is not None:
        flat = LABEL_BANDS[asset_class][0]
        add("sideways", w, "Sideways" if abs(move[w]) <= flat else "Closest to sideways")

    add("most_recent", blocker.first_free(np.argsort(-starts, kind="stable")), "Most recent")

    for k in range(1, n_spread + 1):
        target = min(n - 1, (k * n) // (n_spread + 1))
        w = blocker.first_free(order[p] for p in _around(target, n))
        if w is None:
            break
        add("spread", w, label_for_move(float(move[w]), asset_class))
    return picks


def select_scenarios(win: Windows, values: np.ndarray, asset_class: str,
                     n_total: int = N_SCENARIOS, spacing: int = SPACING_TRADING_DAYS
                     ) -> Tuple[List[Pick], int, List[Dict[str, str]]]:
    """Returns (picks in display order, spacing actually used, warnings)."""
    n = len(win)
    n_spread = max(0, n_total - len(FIXED_ORDER))
    want = min(n_total, n)

    def swing(i: int) -> float:
        seg = values[win.start[i]:win.end[i] + 1]
        return float(seg.max() / seg.min() - 1.0)

    used = max(1, int(spacing))
    while True:
        picks = _pick_once(win, swing, asset_class, used, n_spread)
        if len(picks) >= want or used == 1:
            break
        used = max(1, used // 2)

    fixed = sorted((p for p in picks if p.kind != "spread"), key=lambda p: FIXED_ORDER.index(p.kind))
    spread = sorted((p for p in picks if p.kind == "spread"),
                    key=lambda p: (float(win.move[p.w]), int(win.start[p.w])))
    ordered = (fixed + spread)[:n_total]

    notes: List[Dict[str, str]] = []
    if n < n_total:
        notes.append({"code": "SHORT_HISTORY",
                      "message": f"History only has {n} complete periods of this length, "
                                 f"so {len(ordered)} scenarios are shown instead of {n_total}."})
    elif used < spacing:
        notes.append({"code": "SHORT_HISTORY",
                      "message": f"History is short for this tenor, so picks are {used} trading days "
                                 f"apart instead of {spacing}; some periods overlap a lot."})
    for p in ordered:
        if p.label == "Closest to a 10% drop":
            notes.append({"code": "NO_CLOSE_MATCH",
                          "message": f"No past period fell close to 10%; the closest real move "
                                     f"was {win.move[p.w] * 100:+.2f}%."})
        if p.label == "Closest to sideways":
            notes.append({"code": "NO_CLOSE_MATCH",
                          "message": f"No past period ended near flat; the closest real move "
                                     f"was {win.move[p.w] * 100:+.2f}%."})
    return ordered, used, notes
