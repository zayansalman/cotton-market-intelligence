# Purchaser Inputs — Bangladesh Spinning Mills

> V2 input schema for decision-grade procurement planning.

## Overview

The `PurchaserInput` schema captures everything a Bangladesh spinning mill needs to specify before CMI generates an actionable procurement strategy.  All fields except **required_tonnes** and **planning_horizon_months** are optional — the engine applies sensible Bangladesh defaults when fields are omitted.

---

## Field Groups

### 1. Demand & Production Context

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `required_tonnes` | number | **Yes** | — | Total cotton tonnage to procure |
| `planning_horizon_months` | integer | **Yes** | — | Planning window (1–24 months) |
| `required_by_date` | date | No | — | Hard deadline for full delivery (YYYY-MM-DD) |
| `monthly_consumption_tonnes` | number | No | — | Mill's average monthly cotton consumption |
| `current_inventory_tonnes` | number | No | — | On-hand inventory at mill |
| `in_transit_tonnes` | number | No | — | Cotton currently in transit / on order |
| `min_safety_stock_days` | integer | No | — | Minimum safety stock days to maintain |
| `yarn_count_or_end_use_mix` | string | No | — | Target yarn count / end-use (e.g. "Ne 30-40 combed") |

### 2. Timeline & Execution Window

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `first_arrival_earliest` | date | — | Earliest acceptable first shipment arrival |
| `latest_arrival_date` | date | — | Latest acceptable final arrival |
| `preferred_delivery_cadence` | enum | monthly, biweekly, custom | Delivery rhythm |
| `max_monthly_receipt_capacity_tonnes` | number | — | Max tonnes the mill can receive per month |
| `urgency_level` | enum | standard, urgent, emergency | Procurement urgency |

**Validation**: `first_arrival_earliest` must be ≤ `latest_arrival_date`.

### 3. Quality & Technical Specs

| Field | Type | Description |
|-------|------|-------------|
| `preferred_origins` | string[] | Origins in priority order (e.g. ["US", "Brazil", "India"]) |
| `staple_length_range` | {min, max} | Staple length in mm |
| `micronaire_range` | {min, max} | Micronaire range |
| `strength_min_gpt` | number | Min fiber strength (g/tex) |
| `length_uniformity_min` | number | Min uniformity index (%) |
| `color_grade_range` | string | Acceptable color grades (e.g. "11-31") |
| `leaf_trash_max` | integer | Max leaf/trash grade (1–8) |
| `moisture_max` | number | Max moisture content (%) |
| `contamination_tolerance` | string | Foreign-matter policy |
| `ginning_preference` | enum | roller, saw, any |
| `hvi_required` | boolean | Whether HVI/instrument classing required |

### 4. Commercial Structure

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `pricing_mode` | enum | fixed, on-call, basis-fixed | Pricing mechanism |
| `reference_contract_month` | string | — | ICE reference month (e.g. "Dec 2026") |
| `basis_diff_target` | number | — | Target basis/differential (c/lb) |
| `target_price_walkaway` | object | — | {target_cents_lb, walkaway_cents_lb} |
| `quantity_tolerance_pct` | number | — | Acceptable quantity tolerance (± %) |
| `split_lot_rules` | object | — | {allow_partials, min_lot_tonnes} |

### 5. Logistics & Delivery

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `incoterm` | enum | EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP | Trade term |
| `load_port_preferences` | string[] | — | Preferred load ports |
| `discharge_port` | string | — | Destination port (default: Chattogram) |
| `inland_delivery` | object | — | {required: boolean, mill_location?: string} |
| `shipment_window` | object | — | {earliest, latest} dates |
| `vessel_route_constraints` | string | — | Vessel/route restrictions |

### 6. Finance & Risk

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `payment_term` | enum | lc_at_sight, lc_usance, dp, da, tt_advance, open_account | Payment mechanism |
| `max_credit_days` | integer | — | Max credit days allowed |
| `bank_lc_constraints` | string | — | Bank/L/C facility constraints |
| `fx_assumption` | number | — | Budget FX rate (BDT/USD) |
| `approved_suppliers` | string[] | — | Whitelisted suppliers |
| `max_supplier_concentration_pct` | number | — | Max % from single supplier |
| `traceability_requirements` | string[] | — | Certifications (e.g. BCI, organic, GOTS) |

---

## Presets

### Bangladesh Spinner Default
Standard mid-size spinner: 2,000t over 6 months, CFR Chattogram, on-call pricing, L/C at sight, 30-day safety stock.  Origins: US, Brazil, India, West Africa.  Staple 28–32mm, mic 3.5–4.9, strength ≥28 g/tex.

### Fast Replenishment
Urgent 500t over 2 months.  India-origin only (fast lane: ~14d transit).  Relaxed quality, fixed pricing, biweekly delivery.

### Quality-Critical
1,000t over 4 months for high-count yarn (Ne 40–60 combed compact).  US/Australia only, saw-ginned, HVI required, strict specs (staple ≥30mm, mic 3.8–4.5, strength ≥31 g/tex, leaf ≤3).  CIF with inland delivery.  BCI traceability.

---

## Strategy Engine Behavior

When advanced fields are provided:
- **Binding constraints** are reported (which constraints shaped the buy roadmap)
- **Feasibility score** (0–100) indicates how achievable the plan is given constraints
- **Constraint risks** flag where specs may be hard to satisfy in current markets
- **Assumption set** shows lead-time and execution assumptions used

When no advanced fields are provided (legacy Basic mode), the engine produces output identical to V1.
