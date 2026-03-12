import os

from dotenv import load_dotenv

from cotton_buy_tool import MillProfile, generate_recommendation


def main() -> None:
    load_dotenv()

    cotton_daily_filepath = os.getenv("COTTON_DAILY_DATA_LOCAL_FILEPATH")
    if not cotton_daily_filepath:
        raise RuntimeError(
            "COTTON_DAILY_DATA_LOCAL_FILEPATH is not set in .env. "
            "Please point it to the MacroTrends cotton CSV."
        )

    # Example mill profile; adjust these numbers per mill.
    mill = MillProfile(
        name="Example Spinning Mill",
        daily_yarn_output_kg=50000.0,  # total yarn production per day
        waste_rate_pct=4.0,
        target_inventory_days=60,
    )

    rec = generate_recommendation(
        profile=mill,
        cotton_csv_path=cotton_daily_filepath,
        lookback_years=5,
    )

    print(f"Mill: {rec['mill'].name}")
    print(f"Current nominal price ($/lbs): {rec['benchmarks']['current_price']:.4f}")
    print(f"Current real (CPI-adjusted) price ($/lbs): {rec['latest_real_price']:.4f}")
    print(
        "Benchmarks over last "
        f"{rec['benchmarks']['lookback_years']} years "
        f"(p25/p50/p75): "
        f"{rec['benchmarks']['p25']:.4f} / "
        f"{rec['benchmarks']['p50']:.4f} / "
        f"{rec['benchmarks']['p75']:.4f}"
    )
    print(f"Z-score vs history: {rec['benchmarks']['z_score']:.2f}")
    print(f"Buy signal: {rec['signal']}")
    print(
        "Suggested purchase quantity: "
        f"{rec['suggested_quantity_bales']:.1f} bales "
        f"(target inventory days = {rec['mill'].target_inventory_days})"
    )


if __name__ == "__main__":
    main()

