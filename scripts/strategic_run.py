"""
CLI: strategic cotton procurement plan (signals + news + optional LLM narrative + monthly roadmap).

Requires MacroTrends cotton CSV path via --csv or COTTON_DAILY_DATA_LOCAL_FILEPATH in .env.
Optional: OPENAI_API_KEY for richer narrative (see src/intelligence/synthesis.py).

Run from repo root: python scripts/strategic_run.py ...  or: python -m scripts.strategic_run ...
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from dotenv import load_dotenv

from src.strategic import build_strategic_procurement_plan, plan_to_dict


def _default_csv() -> str | None:
    p = os.getenv("COTTON_DAILY_DATA_LOCAL_FILEPATH")
    if p and Path(p).exists():
        return p
    fallback = Path(__file__).resolve().parent.parent / "data" / "cotton_macrotrends_daily.csv"
    if fallback.exists():
        return str(fallback)
    return None


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Build a month-by-month cotton procurement roadmap from price signals and news."
    )
    parser.add_argument("--company", default="Example Mill", help="Label for the plan")
    parser.add_argument("--tonnes", type=float, required=True, help="Total cotton needed (tonnes)")
    parser.add_argument("--months", type=int, required=True, help="Forward horizon in months")
    parser.add_argument(
        "--csv",
        default=None,
        help="MacroTrends cotton daily CSV path (else COTTON_DAILY_DATA_LOCAL_FILEPATH or data/cotton_macrotrends_daily.csv)",
    )
    parser.add_argument("--mill-profile", default=None, help="Key from config/mill_profiles.yml")
    parser.add_argument("--worldbank-xlsx", default=os.getenv("WB_COMMODITIES_DATA_LOCAL_FILEPATH"))
    parser.add_argument("--json", action="store_true", help="Print JSON only (for piping)")
    args = parser.parse_args()

    csv_path = args.csv or _default_csv()
    if not csv_path:
        print(
            "Error: no cotton CSV. Set COTTON_DAILY_DATA_LOCAL_FILEPATH in .env or pass --csv.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not Path(csv_path).exists():
        print(f"Error: file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    wb = args.worldbank_xlsx
    if wb and not Path(wb).exists():
        wb = None

    plan = build_strategic_procurement_plan(
        company=args.company,
        total_tonnes=args.tonnes,
        horizon_months=args.months,
        macrotrends_csv=csv_path,
        mill_profile_name=args.mill_profile,
        worldbank_xlsx=wb,
    )
    out = plan_to_dict(plan)

    if args.json:
        print(json.dumps(out, indent=2))
        return

    print(f"Company: {out['company']}")
    print(f"Need: {out['target_tonnes']:.1f} t over {out['horizon_months']} months")
    print(f"Signal (near-term): {out['signal']} — suggested spot tranche: {out['suggested_near_term_tons']:.2f} t")
    n = out["news"]
    print(
        f"News sentiment: {n['sentiment']:.3f} (sources: {n['sources']})"
        + (
            f" | keyword {n.get('keyword_sentiment', 0):.3f}"
            + (
                f" | HF {n['hf_sentiment']:.3f} ({n['hf_model']})"
                if n.get("hf_sentiment") is not None and n.get("hf_model")
                else ""
            )
        )
    )
    print("\n--- Roadmap (tonnes per month) ---")
    for row in out["roadmap"]:
        print(
            f"  M{row['month']}: {row['tonnes']:.1f} t  "
            f"({row['start'][:10]} … {row['end'][:10]})  {row['note']}"
        )
    print("\n--- Narrative ---")
    n = out["narrative"]
    print(n["executive_summary"])
    print()
    print(n["procurement_rationale"])
    print("\nRisks:", "; ".join(n["risk_factors"]))
    print("Next:", "; ".join(n["next_actions"]))


if __name__ == "__main__":
    main()
