"use client";

import type { PurchaserInput } from "@/lib/types";
import FieldSection from "./FieldSection";

interface AdvancedBriefProps {
  input: PurchaserInput;
  updateSection: <K extends keyof Omit<PurchaserInput, "demand">>(
    section: K,
    patch: Partial<NonNullable<PurchaserInput[K]>>
  ) => void;
  updateDemand: (patch: Partial<PurchaserInput["demand"]>) => void;
  validationErrors: Array<{ path: string; message: string }>;
}

function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">
        {label}
        {hint && (
          <span className="text-zinc-600 ml-1 font-normal">({hint})</span>
        )}
      </label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? undefined : Number(e.target.value))
      }
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function getError(
  errors: Array<{ path: string; message: string }>,
  path: string
): string | undefined {
  return errors.find((e) => e.path === path)?.message;
}

export default function AdvancedBrief({
  input,
  updateSection,
  updateDemand,
  validationErrors: errors,
}: AdvancedBriefProps) {
  return (
    <div className="space-y-2">
      {/* Demand (extended) */}
      <FieldSection title="Demand & Production" defaultOpen>
        <Field label="Monthly consumption" hint="tonnes">
          <NumberInput
            value={input.demand.monthly_consumption_tonnes}
            onChange={(v) => updateDemand({ monthly_consumption_tonnes: v })}
            min={0}
          />
        </Field>
        <Field label="Current inventory" hint="tonnes">
          <NumberInput
            value={input.demand.current_inventory_tonnes}
            onChange={(v) => updateDemand({ current_inventory_tonnes: v })}
            min={0}
          />
        </Field>
        <Field label="In transit" hint="tonnes">
          <NumberInput
            value={input.demand.in_transit_tonnes}
            onChange={(v) => updateDemand({ in_transit_tonnes: v })}
            min={0}
          />
        </Field>
        <Field label="Safety stock" hint="days">
          <NumberInput
            value={input.demand.min_safety_stock_days}
            onChange={(v) => updateDemand({ min_safety_stock_days: v })}
            min={0}
          />
        </Field>
        <Field label="Required by" hint="YYYY-MM-DD" error={getError(errors, "demand.required_by_date")}>
          <TextInput
            value={input.demand.required_by_date ?? ""}
            onChange={(v) => updateDemand({ required_by_date: v || undefined })}
            placeholder="2026-12-31"
          />
        </Field>
      </FieldSection>

      {/* Timeline */}
      <FieldSection title="Timeline & Execution">
        <Field label="Urgency">
          <SelectInput
            value={input.timeline?.urgency_level}
            onChange={(v) =>
              updateSection("timeline", {
                urgency_level: v as "standard" | "urgent" | "emergency",
              })
            }
            options={[
              { value: "standard", label: "Standard" },
              { value: "urgent", label: "Urgent" },
              { value: "emergency", label: "Emergency" },
            ]}
          />
        </Field>
        <Field label="Delivery cadence">
          <SelectInput
            value={input.timeline?.preferred_delivery_cadence}
            onChange={(v) =>
              updateSection("timeline", {
                preferred_delivery_cadence: v as "monthly" | "biweekly" | "custom",
              })
            }
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "biweekly", label: "Biweekly" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </Field>
        <Field label="Max monthly receipt" hint="tonnes">
          <NumberInput
            value={input.timeline?.max_monthly_receipt_capacity_tonnes}
            onChange={(v) =>
              updateSection("timeline", { max_monthly_receipt_capacity_tonnes: v })
            }
            min={0}
          />
        </Field>
        <Field
          label="First arrival earliest"
          hint="YYYY-MM-DD"
          error={getError(errors, "timeline.first_arrival_earliest")}
        >
          <TextInput
            value={input.timeline?.first_arrival_earliest ?? ""}
            onChange={(v) =>
              updateSection("timeline", { first_arrival_earliest: v || undefined })
            }
            placeholder="2026-06-01"
          />
        </Field>
        <Field
          label="Latest arrival"
          hint="YYYY-MM-DD"
          error={getError(errors, "timeline.latest_arrival_date")}
        >
          <TextInput
            value={input.timeline?.latest_arrival_date ?? ""}
            onChange={(v) =>
              updateSection("timeline", { latest_arrival_date: v || undefined })
            }
            placeholder="2026-12-31"
          />
        </Field>
      </FieldSection>

      {/* Quality */}
      <FieldSection title="Quality & Specs">
        <Field label="Preferred origins" hint="comma-separated">
          <TextInput
            value={input.quality?.preferred_origins?.join(", ") ?? ""}
            onChange={(v) =>
              updateSection("quality", {
                preferred_origins: v
                  ? v.split(",").map((s) => s.trim()).filter(Boolean)
                  : undefined,
              })
            }
            placeholder="US, Brazil, India"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Staple min" hint="mm">
            <NumberInput
              value={input.quality?.staple_length_range?.min}
              onChange={(v) =>
                updateSection("quality", {
                  staple_length_range: {
                    min: v ?? 0,
                    max: input.quality?.staple_length_range?.max ?? 40,
                  },
                })
              }
            />
          </Field>
          <Field label="Staple max" hint="mm">
            <NumberInput
              value={input.quality?.staple_length_range?.max}
              onChange={(v) =>
                updateSection("quality", {
                  staple_length_range: {
                    min: input.quality?.staple_length_range?.min ?? 20,
                    max: v ?? 40,
                  },
                })
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mic min">
            <NumberInput
              value={input.quality?.micronaire_range?.min}
              onChange={(v) =>
                updateSection("quality", {
                  micronaire_range: {
                    min: v ?? 0,
                    max: input.quality?.micronaire_range?.max ?? 6,
                  },
                })
              }
              step={0.1}
            />
          </Field>
          <Field label="Mic max">
            <NumberInput
              value={input.quality?.micronaire_range?.max}
              onChange={(v) =>
                updateSection("quality", {
                  micronaire_range: {
                    min: input.quality?.micronaire_range?.min ?? 2,
                    max: v ?? 6,
                  },
                })
              }
              step={0.1}
            />
          </Field>
        </div>
        <Field label="Strength min" hint="g/tex">
          <NumberInput
            value={input.quality?.strength_min_gpt}
            onChange={(v) => updateSection("quality", { strength_min_gpt: v })}
          />
        </Field>
        <Field label="Ginning preference">
          <SelectInput
            value={input.quality?.ginning_preference}
            onChange={(v) =>
              updateSection("quality", {
                ginning_preference: v as "roller" | "saw" | "any",
              })
            }
            options={[
              { value: "any", label: "Any" },
              { value: "roller", label: "Roller" },
              { value: "saw", label: "Saw" },
            ]}
          />
        </Field>
      </FieldSection>

      {/* Commercial */}
      <FieldSection title="Commercial">
        <Field label="Pricing mode">
          <SelectInput
            value={input.commercial?.pricing_mode}
            onChange={(v) =>
              updateSection("commercial", {
                pricing_mode: v as "fixed" | "on-call" | "basis-fixed",
              })
            }
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "on-call", label: "On-call" },
              { value: "basis-fixed", label: "Basis-fixed" },
            ]}
          />
        </Field>
        <Field label="Basis / diff target" hint="c/lb">
          <NumberInput
            value={input.commercial?.basis_diff_target}
            onChange={(v) => updateSection("commercial", { basis_diff_target: v })}
            step={0.5}
          />
        </Field>
        <Field label="Quantity tolerance" hint="%">
          <NumberInput
            value={input.commercial?.quantity_tolerance_pct}
            onChange={(v) =>
              updateSection("commercial", { quantity_tolerance_pct: v })
            }
            min={0}
            max={100}
          />
        </Field>
      </FieldSection>

      {/* Logistics */}
      <FieldSection title="Logistics">
        <Field label="Incoterm">
          <SelectInput
            value={input.logistics?.incoterm}
            onChange={(v) => updateSection("logistics", { incoterm: v as PurchaserInput["logistics"] extends { incoterm?: infer T } ? NonNullable<T> : never })}
            options={[
              { value: "FOB", label: "FOB" },
              { value: "CFR", label: "CFR" },
              { value: "CIF", label: "CIF" },
              { value: "DAP", label: "DAP" },
              { value: "DDP", label: "DDP" },
            ]}
          />
        </Field>
        <Field label="Discharge port">
          <TextInput
            value={input.logistics?.discharge_port ?? ""}
            onChange={(v) =>
              updateSection("logistics", { discharge_port: v || undefined })
            }
            placeholder="Chattogram"
          />
        </Field>
        <Field label="Load port preferences" hint="comma-separated">
          <TextInput
            value={input.logistics?.load_port_preferences?.join(", ") ?? ""}
            onChange={(v) =>
              updateSection("logistics", {
                load_port_preferences: v
                  ? v.split(",").map((s) => s.trim()).filter(Boolean)
                  : undefined,
              })
            }
            placeholder="Houston, Santos"
          />
        </Field>
      </FieldSection>

      {/* Finance */}
      <FieldSection title="Finance & Risk">
        <Field label="Payment term">
          <SelectInput
            value={input.finance?.payment_term}
            onChange={(v) =>
              updateSection("finance", {
                payment_term: v as PurchaserInput["finance"] extends { payment_term?: infer T } ? NonNullable<T> : never,
              })
            }
            options={[
              { value: "lc_at_sight", label: "L/C at sight" },
              { value: "lc_usance", label: "L/C usance" },
              { value: "dp", label: "D/P" },
              { value: "da", label: "D/A" },
              { value: "tt_advance", label: "T/T advance" },
              { value: "open_account", label: "Open account" },
            ]}
          />
        </Field>
        <Field label="Max credit days">
          <NumberInput
            value={input.finance?.max_credit_days}
            onChange={(v) => updateSection("finance", { max_credit_days: v })}
            min={0}
          />
        </Field>
        <Field label="FX assumption" hint="BDT/USD">
          <NumberInput
            value={input.finance?.fx_assumption}
            onChange={(v) => updateSection("finance", { fx_assumption: v })}
            min={0}
            step={0.5}
          />
        </Field>
        <Field label="Max supplier concentration" hint="%">
          <NumberInput
            value={input.finance?.max_supplier_concentration_pct}
            onChange={(v) =>
              updateSection("finance", { max_supplier_concentration_pct: v })
            }
            min={0}
            max={100}
          />
        </Field>
        <Field label="Traceability" hint="comma-separated">
          <TextInput
            value={input.finance?.traceability_requirements?.join(", ") ?? ""}
            onChange={(v) =>
              updateSection("finance", {
                traceability_requirements: v
                  ? v.split(",").map((s) => s.trim()).filter(Boolean)
                  : undefined,
              })
            }
            placeholder="BCI, organic"
          />
        </Field>
      </FieldSection>
    </div>
  );
}
