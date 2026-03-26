from __future__ import annotations

from dataclasses import dataclass

from .mills.capacity_v1 import (
    compute_daily_cotton_consumption as _compute_daily_cotton_consumption,
    compute_base_order_quantity as _compute_base_order_quantity,
)


@dataclass
class MillProfile:
    name: str
    spindles: int
    spindle_speed_rpm: float
    yarn_count_ne: float
    machine_efficiency: float
    shifts_per_day: int
    target_days_inventory: int
    waste_factor: float = 0.05
    buys_per_year: int = 12
    max_order_tons: float | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "MillProfile":
        return cls(
            name=d["name"],
            spindles=int(d["spindles"]),
            spindle_speed_rpm=float(d["spindle_speed_rpm"]),
            yarn_count_ne=float(d["yarn_count_ne"]),
            machine_efficiency=float(d["machine_efficiency"]),
            shifts_per_day=int(d["shifts_per_day"]),
            target_days_inventory=int(d["target_days_inventory"]),
            waste_factor=float(d.get("waste_factor", 0.05)),
            buys_per_year=int(d.get("buys_per_year", 12)),
            max_order_tons=(
                float(d["max_order_tons"]) if d.get("max_order_tons") is not None else None
            ),
        )


def compute_daily_cotton_consumption(profile: MillProfile) -> float:
    return _compute_daily_cotton_consumption(profile)  # type: ignore[arg-type]


def compute_base_order_quantity(profile: MillProfile) -> float:
    return _compute_base_order_quantity(profile)  # type: ignore[arg-type]


__all__ = [
    "MillProfile",
    "compute_daily_cotton_consumption",
    "compute_base_order_quantity",
]

