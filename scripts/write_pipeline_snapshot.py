"""Write artifacts/pipeline_snapshot.json for dashboard and CI (cloud-friendly)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from dotenv import load_dotenv

from src.pipeline_snapshot import write_snapshot


def main() -> None:
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument(
        "-o",
        "--output",
        default=os.getenv("CMI_PIPELINE_SNAPSHOT", "artifacts/pipeline_snapshot.json"),
    )
    p.add_argument("--company", default="CI Snapshot")
    p.add_argument("--tonnes", type=float, default=5000.0)
    p.add_argument("--months", type=int, default=6)
    args = p.parse_args()

    out = write_snapshot(
        args.output,
        company=args.company,
        total_tonnes=args.tonnes,
        horizon_months=args.months,
    )
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
