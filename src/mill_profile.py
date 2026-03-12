from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MillProfile:
    """
    Representation of a spinning mill for cotton consumption modelling.

    There are two ways to parameterize a mill:
    - Directly via daily yarn output in kg (simpler, recommended for now)
    - Via spindle/yarn parameters (spindles, RPM, yarn count, efficiency, shifts),
      which can be converted into daily yarn output.
    """

    name: str

    # Direct specification
    daily_yarn_output_kg: float | None = None

    # Spindle-based specification
    spindles: int | None = None
    spindle_rpm: float | None = None
    yarn_count_ne: float | None = None
    efficiency_pct: float = 90.0
    shifts_per_day: int = 2

    # Policy parameters
    waste_rate_pct: float = 4.0
    target_inventory_days: int = 60

    def estimate_daily_yarn_output_kg(self) -> float:
        """
        Estimate daily yarn output in kg.

        If daily_yarn_output_kg is set explicitly, use it. Otherwise, derive it
        from the spindle parameters using standard ring frame production logic.

        This is intentionally approximate; in practice you'd calibrate it against
        mill-specific data.
        """
        if self.daily_yarn_output_kg is not None:
            return float(self.daily_yarn_output_kg)

        if (
            self.spindles is None
            or self.spindle_rpm is None
            or self.yarn_count_ne is None
        ):
            raise ValueError(
                "Either daily_yarn_output_kg must be provided or "
                "spindles, spindle_rpm, and yarn_count_ne must be set."
            )

        # Very approximate spindle-based production formula:
        # Production (lbs/day) ≈ (spindles × RPM × 60 × 60 × hours × eff) /
        #                        (TPI × Ne × 840 × 36)
        # We simplify with a representative twist multiplier and working hours.
        hours_per_shift = 8
        tpi_multiplier = 4.5  # approximate for cotton
        tpi = tpi_multiplier * (self.yarn_count_ne ** 0.5)

        eff = self.efficiency_pct / 100.0

        numerator = (
            self.spindles
            * self.spindle_rpm
            * 60
            * hours_per_shift
            * self.shifts_per_day
            * eff
        )
        denominator = tpi * self.yarn_count_ne * 840 * 36

        if denominator <= 0:
            raise ValueError("Invalid parameters for yarn production calculation.")

        production_lbs_per_day = numerator / denominator
        production_kg_per_day = production_lbs_per_day * 0.453592
        return float(production_kg_per_day)

    def estimate_daily_cotton_consumption_kg(self) -> float:
        """
        Estimate daily cotton consumption including process waste.
        """
        yarn_kg = self.estimate_daily_yarn_output_kg()
        gross_factor = 1.0 + self.waste_rate_pct / 100.0
        return yarn_kg * gross_factor

    def target_inventory_kg(self) -> float:
        """
        Target cotton inventory in kg, based on daily consumption and target days.
        """
        daily_cotton_kg = self.estimate_daily_cotton_consumption_kg()
        return daily_cotton_kg * self.target_inventory_days

