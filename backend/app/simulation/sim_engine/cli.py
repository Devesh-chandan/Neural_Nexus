"""Command line for the historical-replay engine.

  python -m sim_engine run sample_inputs/eln_100.json --index 0     one product, table view
  python -m sim_engine run sample_inputs/eln_100.json               every product in the file
  python -m sim_engine fetch --from sample_inputs/eln_100.json      download + cache prices
  python -m sim_engine check sample_inputs/dcd_100.json             validate inputs only
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

from .config import ENGINE_VERSION
from .engine import Settings, run_batch, run_simulation
from .errors import SimulationError
from .schema import parse_product
from .stories import fmt_money
from .storage import save_run
from .underlyings import resolve_underlying


def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _load_items(path: str) -> List[Any]:
    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("products"), list):
        return data["products"]
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return data
    raise ValueError("The input file must hold a product object or a list of products.")


def _write_json(path: str, obj: Any) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def _terms_line(prod: Dict[str, Any], currency: str) -> str:
    t = prod["product_type"]
    parts = [t, prod["underlying"], f"notional {fmt_money(prod['notional'], currency)}",
             f"{prod['tenor']:g} month" + ("" if prod["tenor"] == 1 else "s"), f"coupon {prod['coupon_pa'] * 100:.2f}% p.a."]
    if t == "ELN":
        parts.append(f"strike {prod['strike_pct'] * 100:.0f}%")
        parts.append(f"barrier {prod['barrier_pct'] * 100:.0f}%" if prod["barrier_pct"] else "no barrier")
    elif t == "CPN":
        parts.append(f"protection {prod['protection_pct'] * 100:.0f}%")
        parts.append(f"participation {prod['participation_pct'] * 100:.0f}%")
        parts.append(f"cap {prod['cap_pct'] * 100:.1f}%" if prod["cap_pct"] else "no cap")
    else:
        parts.append(f"strike {prod['strike_rate']}")
        parts.append(f"may repay in {prod['alt_currency']}")
    return " | ".join(parts)


def print_table(res: Dict[str, Any], show_stories: bool = True) -> None:
    a = res["audit"]
    prod, md, sel = a["product"], a["market_data"], a["selection"]
    ccy = res["currency"]
    hit_head = {"ELN": "Barrier", "DCD": "Converted", "CPN": "Trigger"}[prod["product_type"]]
    print()
    print(_terms_line(prod, ccy))
    print(f"Prices: {md['ticker']} {md['first_date']} -> {md['last_date']} ({md['source']}) | "
          f"{sel['periods_available']:,} periods in the line-up | run {res['run_id']}")
    print()
    head = f"{'#':>2}  {'Situation':<22}{'Period':<26}{'Move':>9}  {hit_head:<10}{'Money back':>20}{'Return':>10}"
    print(head)
    print("-" * len(head))
    for s in res["scenarios"]:
        period = f"{s['period']['start']} -> {s['period']['end']}"
        hit = "yes" if s["barrier_hit"] else "no"
        if prod["product_type"] == "CPN":
            hit = "-"
        print(f"{s['id']:>2}  {s['situation']:<22}{period:<26}{s['market_move_pct']:>+8.2f}%  {hit:<10}"
              f"{fmt_money(s['money_back'], ccy):>20}{s['return_pct']:>+9.2f}%")
    rets = [s["return_pct"] for s in res["scenarios"]]
    lost = sum(1 for r in rets if r < 0)
    print("-" * len(head))
    print(f"Lost money in {lost} of {len(rets)} | worst {min(rets):+.2f}% | best {max(rets):+.2f}% "
          f"| data as of {res['data_as_of']}")
    if res["warnings"]:
        print("\nWarnings:")
        for w in res["warnings"]:
            print(f"  - {w['code']}: {w['message']}")
    if show_stories:
        print("\nStories:")
        for s in res["scenarios"]:
            print(f"  {s['id']:>2}. {s['story']}")
    print()


def _settings(args: argparse.Namespace) -> Settings:
    return Settings(history_until=args.history_until)


def _market(args: argparse.Namespace):
    """The backend's market service (live -> cache -> seed); a CSV in <data-dir>/prices still wins."""
    from app.simulation.market import BackendMarket
    return BackendMarket(data_dir=args.data_dir)


def cmd_run(args: argparse.Namespace) -> int:
    items = _load_items(args.file)
    market = _market(args)
    settings = _settings(args)
    stem = os.path.splitext(os.path.basename(args.file))[0]

    if args.index is not None:
        if not 0 <= args.index < len(items):
            print(f"--index must be between 0 and {len(items) - 1}", file=sys.stderr)
            return 2
        try:
            res = run_simulation(items[args.index], settings, market)
        except SimulationError as exc:
            print(json.dumps({"status": "error", "error": exc.to_dict()}, indent=2, ensure_ascii=False))
            return 1
        if not args.no_save:
            save_run(res, args.runs_dir)
        out = args.out or os.path.join("out", f"{stem}_{args.index}.json")
        _write_json(out, res)
        if args.json:
            print(json.dumps(res, indent=2, ensure_ascii=False))
        else:
            print_table(res, show_stories=not args.no_stories)
            print(f"Saved: {out}" + ("" if args.no_save else f" and {os.path.join(args.runs_dir, res['run_id'] + '.json')}"))
        return 0

    results = run_batch(items, settings, market)
    ok = 0
    if not args.json:
        print(f"\n{'#':>3}  {'Type':<5}{'Underlying':<14}{'Tenor':>7}  {'Status':<8}{'Lost':>7}"
              f"{'Worst':>10}{'Best':>10}{'Warn':>6}  Run / error")
    for item, row in zip(items, results):
        u = str(item.get("underlying", "?")) if isinstance(item, dict) else "?"
        t = str(item.get("product_type", "?")) if isinstance(item, dict) else "?"
        tenor = item.get("tenor", "?") if isinstance(item, dict) else "?"
        if row["status"] == "ok":
            ok += 1
            res = row["result"]
            if not args.no_save:
                save_run(res, args.runs_dir)
            rets = [s["return_pct"] for s in res["scenarios"]]
            lost = sum(1 for r in rets if r < 0)
            if not args.json:
                print(f"{row['index']:>3}  {t:<5}{u:<14}{str(tenor) + 'm':>7}  {'ok':<8}"
                      f"{f'{lost}/{len(rets)}':>7}{min(rets):>+9.1f}%{max(rets):>+9.1f}%"
                      f"{len(res['warnings']):>6}  {res['run_id']}")
        elif not args.json:
            err = row["error"]
            print(f"{row['index']:>3}  {t:<5}{u:<14}{str(tenor) + 'm':>7}  {'ERROR':<8}{'':>7}{'':>10}{'':>10}"
                  f"{'':>6}  {err['code']}: {err['message'][:110]}")
    out = args.out or os.path.join("out", f"{stem}_results.json")
    _write_json(out, results)
    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(f"\n{ok} of {len(items)} products simulated. Results: {out}"
              + ("" if args.no_save else f" | each run saved in {args.runs_dir}/"))
    return 0 if ok else 1


def cmd_fetch(args: argparse.Namespace) -> int:
    names: List[str] = [u.upper() for u in args.underlyings]
    for path in args.from_files or []:
        names += [str(i.get("underlying", "")).upper() for i in _load_items(path) if isinstance(i, dict)]
    names = sorted({n.strip() for n in names if n.strip()})
    if not names:
        print("Give underlyings (e.g. NIFTY USD/INR) or --from FILE.", file=sys.stderr)
        return 2
    market = _market(args)
    failed = 0
    for name in names:
        try:
            info = resolve_underlying(name, args.data_dir)
            d = market.get(info)
            a = d.audit()
            flag = " (" + ", ".join(w["code"] for w in d.warnings) + ")" if d.warnings else ""
            print(f"OK    {name:<14}{info.ticker:<24}{a['first_date']} -> {a['last_date']}  "
                  f"{a['rows']:>6,} rows  {a['source']}{flag}")
        except SimulationError as exc:
            failed += 1
            print(f"FAIL  {name:<14}{exc.message}")
    print(f"\n{len(names) - failed} of {len(names)} underlyings ready")
    return 1 if failed else 0


def cmd_check(args: argparse.Namespace) -> int:
    items = _load_items(args.file)
    bad = 0
    for i, raw in enumerate(items):
        try:
            p, warns = parse_product(raw)
            resolve_underlying(p.underlying, args.data_dir)
            note = ("  warnings: " + "; ".join(w["message"] for w in warns)) if warns else ""
            print(f"{i:>3}  OK     {p.product_type} {p.underlying} {p.product_id}{note}")
        except SimulationError as exc:
            bad += 1
            detail = "; ".join(f"{d['field']} {d['message']}" for d in exc.details) or exc.message
            print(f"{i:>3}  ERROR  {detail}")
    print(f"\n{len(items) - bad} of {len(items)} products valid.")
    return 1 if bad else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.simulation.sim_engine",
                                description=f"Historical-replay simulation engine ({ENGINE_VERSION}): "
                                            "replay a product on 20 real past market periods.")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--data-dir", default="data/sim", help="folder with optional local price CSVs in prices/ (default: data/sim)")

    r = sub.add_parser("run", help="simulate the products in a JSON file")
    r.add_argument("file", help="JSON file with one product or a list of products")
    r.add_argument("--index", type=int, help="run only this product (0-based) and show its table")
    r.add_argument("--out", help="where to write the JSON result")
    r.add_argument("--json", action="store_true", help="print raw JSON instead of tables")
    r.add_argument("--history-until", choices=["latest", "start_date"], default="latest",
                   help="latest: use all history (default). start_date: only data up to the product's start_date")
    r.add_argument("--runs-dir", default="runs", help="folder where each run is saved (default: runs)")
    r.add_argument("--no-save", action="store_true", help="do not save runs to --runs-dir")
    r.add_argument("--no-stories", action="store_true", help="hide the story lines in the table view")
    common(r)
    r.set_defaults(func=cmd_run)

    f = sub.add_parser("fetch", help="load prices through the backend market service (fills its cache) before a demo")
    f.add_argument("underlyings", nargs="*", help="e.g. NIFTY RELIANCE USD/INR")
    f.add_argument("--from", dest="from_files", action="append", help="take underlyings from this input file")
    common(f)
    f.set_defaults(func=cmd_fetch)

    c = sub.add_parser("check", help="validate a products file without running it")
    c.add_argument("file")
    common(c)
    c.set_defaults(func=cmd_check)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    _utf8_stdout()
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
