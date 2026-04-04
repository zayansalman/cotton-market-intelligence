# V2 Worked Scenarios

> Example procurement scenarios demonstrating how different constraints produce different strategies.

---

## Scenario 1: Standard Bangladesh Spinner

**Context**: Mid-size spinner needs routine restocking.

```json
{
  "demand": { "required_tonnes": 2000, "planning_horizon_months": 6, "monthly_consumption_tonnes": 400, "min_safety_stock_days": 30 },
  "timeline": { "urgency_level": "standard", "preferred_delivery_cadence": "monthly" },
  "quality": { "preferred_origins": ["US", "Brazil", "India"], "staple_length_range": { "min": 28, "max": 32 }, "micronaire_range": { "min": 3.5, "max": 4.9 }, "strength_min_gpt": 28 },
  "commercial": { "pricing_mode": "on-call", "quantity_tolerance_pct": 5 },
  "logistics": { "incoterm": "CFR", "discharge_port": "Chattogram" },
  "finance": { "payment_term": "lc_at_sight", "max_credit_days": 90, "fx_assumption": 117 }
}
```

**Expected behavior**: Allocation follows market signal (front-loaded if cheap, back-loaded if expensive).  No urgency penalty.  High feasibility score (~85+).

---

## Scenario 2: Emergency Replenishment

**Context**: Mill running low on cotton, needs fast delivery from nearby origin.

```json
{
  "demand": { "required_tonnes": 500, "planning_horizon_months": 2, "min_safety_stock_days": 14 },
  "timeline": { "urgency_level": "emergency", "preferred_delivery_cadence": "biweekly" },
  "quality": { "preferred_origins": ["India"], "ginning_preference": "any", "hvi_required": false },
  "commercial": { "pricing_mode": "fixed" },
  "logistics": { "incoterm": "CFR", "discharge_port": "Chattogram" },
  "finance": { "payment_term": "lc_at_sight", "fx_assumption": 117 }
}
```

**Expected behavior**: Heavy front-loading (M1 gets 60–70%).  Binding constraints: emergency urgency, single origin (India).  Constraint risks: supply concentration.  Lower feasibility (~55–65).

---

## Scenario 3: Quality-Critical for Premium Yarn

**Context**: Export-quality spinner sourcing for fine-count yarn production.

```json
{
  "demand": { "required_tonnes": 1000, "planning_horizon_months": 4, "min_safety_stock_days": 45, "yarn_count_or_end_use_mix": "Ne 40-60 combed compact" },
  "quality": { "preferred_origins": ["US", "Australia"], "staple_length_range": { "min": 30, "max": 34 }, "micronaire_range": { "min": 3.8, "max": 4.5 }, "strength_min_gpt": 31, "length_uniformity_min": 82, "leaf_trash_max": 3, "contamination_tolerance": "zero plastic", "hvi_required": true },
  "commercial": { "pricing_mode": "on-call", "split_lot_rules": { "allow_partials": false, "min_lot_tonnes": 100 } },
  "logistics": { "incoterm": "CIF", "discharge_port": "Chattogram", "inland_delivery": { "required": true, "mill_location": "Gazipur" } },
  "finance": { "payment_term": "lc_usance", "max_credit_days": 120, "max_supplier_concentration_pct": 40, "traceability_requirements": ["BCI"] }
}
```

**Expected behavior**: Smoothed allocation (tight quality narrows supply, reduces execution pressure).  Binding constraints: strict quality (2+ parameters), HVI required, long-haul origins only.  Constraint risks: narrow quality window limits supply.  Moderate feasibility (~60–70).

---

## Scenario 4: Cash-Constrained Buyer

**Context**: Smaller mill with tight bank credit facility.

```json
{
  "demand": { "required_tonnes": 1500, "planning_horizon_months": 6, "monthly_consumption_tonnes": 250 },
  "timeline": { "urgency_level": "standard", "max_monthly_receipt_capacity_tonnes": 300 },
  "quality": { "preferred_origins": ["India", "West Africa"] },
  "commercial": { "pricing_mode": "fixed", "quantity_tolerance_pct": 10 },
  "logistics": { "incoterm": "FOB" },
  "finance": { "payment_term": "lc_at_sight", "max_credit_days": 60, "max_supplier_concentration_pct": 30, "fx_assumption": 117 }
}
```

**Expected behavior**: Credit limit dampens early-month concentration.  Receipt capacity close to average need.  Binding constraints: credit limit (60d), receipt capacity, supplier concentration cap.  Lower feasibility (~65–75).

---

## Scenario 5: Legacy Basic Mode (V1 Compatibility)

**Context**: User only provides tonnage and months (existing V1 behavior).

```json
{
  "tonnage": 2000,
  "months": 6
}
```

**Expected behavior**: Identical output to V1 heuristic.  No binding constraints.  Feasibility = 100.  Allocation driven purely by price percentile, z-score, and volatility.
