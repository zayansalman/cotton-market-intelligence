"use client";

import type { PresetName } from "@/lib/types";

const PRESET_LABELS: Record<PresetName, { label: string; description: string }> = {
  bangladesh_spinner: {
    label: "Bangladesh Spinner",
    description: "Mid-size spinner, 6-month horizon, CFR Chattogram",
  },
  fast_replenishment: {
    label: "Fast Replenishment",
    description: "Urgent 2-month, India-origin, relaxed quality",
  },
  quality_critical: {
    label: "Quality-Critical",
    description: "High-count yarn, strict HVI, US/Australia origin",
  },
};

interface PresetSelectorProps {
  onSelect: (name: PresetName) => void;
}

export default function PresetSelector({ onSelect }: PresetSelectorProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 block">Load preset</label>
      <div className="space-y-1">
        {(Object.entries(PRESET_LABELS) as [PresetName, typeof PRESET_LABELS[PresetName]][]).map(
          ([key, { label, description }]) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className="w-full text-left px-2.5 py-1.5 rounded-md border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="text-xs text-zinc-200 font-medium">{label}</span>
              <span className="text-[10px] text-zinc-500 block">{description}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
