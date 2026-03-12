import os
from pathlib import Path

from dotenv import load_dotenv

from src.decision_engine import generate_recommendation, recommendation_to_dict
from src.mill_profile import MillProfile


def main() -> None:
    load_dotenv()

    cotton_daily_filepath = os.getenv("COTTON_DAILY_DATA_LOCAL_FILEPATH")
    if not cotton_daily_filepath:
        raise RuntimeError(
            "COTTON_DAILY_DATA_LOCAL_FILEPATH is not set in .env. "
            "Please point it to the MacroTrends cotton CSV."
        )

    cotton_daily_path = Path(cotton_daily_filepath)
    if not cotton_daily_path.exists():
        raise FileNotFoundError(
            f"Cotton CSV file not found at {cotton_daily_path}. "
            "Update COTTON_DAILY_DATA_LOCAL_FILEPATH in your .env."
        )

    # Example mill profile; adjust these numbers per mill.
    mill = MillProfile(
        name="Example Spinning Mill",
        daily_yarn_output_kg=50000.0,
        waste_rate_pct=4.0,
        target_inventory_days=60,
    )

    rec = generate_recommendation(
        mill=mill,
        cotton_csv_path=str(cotton_daily_path),
        lookback_years=5,
        vol_window_days=60,
    )

    rec_dict = recommendation_to_dict(rec)

    print(f"Mill: {rec_dict['mill']['name']}")
    print(f"Current nominal price ($/lbs): {rec_dict['latest_nominal_price']:.4f}")
    print(f"Current real (CPI-adjusted) price ($/lbs): {rec_dict['latest_real_price']:.4f}")
    print(
        "Benchmarks over last "
        f"{rec_dict['benchmarks']['horizon_years']:.0f} years "
        f"(p25/p50/p75): "
        f"{rec_dict['benchmarks']['p25']:.4f} / "
        f"{rec_dict['benchmarks']['p50']:.4f} / "
        f"{rec_dict['benchmarks']['p75']:.4f}"
    )
    print(f"Value z-score vs history: {rec_dict['benchmarks']['z_score']:.2f}")
    print(f"Signal: {rec_dict['signal']}")
    print(rec_dict["commentary"])
    print(
        "Suggested purchase quantity: "
        f"{rec_dict['suggested_order_bales']:.1f} bales "
        f"({rec_dict['suggested_order_kg']:.0f} kg) "
        f"for target inventory of {rec_dict['mill']['target_inventory_days']} days."
    )


if __name__ == "__main__":
    main()

