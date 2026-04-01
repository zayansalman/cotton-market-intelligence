"use client";

interface BasicBriefProps {
  tonnes: number;
  months: number;
  onTonnesChange: (v: number) => void;
  onMonthsChange: (v: number) => void;
}

export default function BasicBrief({
  tonnes,
  months,
  onTonnesChange,
  onMonthsChange,
}: BasicBriefProps) {
  return (
    <>
      <div>
        <label className="text-xs text-zinc-500 block mb-1">
          Tonnes needed
        </label>
        <input
          type="number"
          value={tonnes}
          onChange={(e) => onTonnesChange(Number(e.target.value))}
          min={1}
          step={500}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <label className="text-xs text-zinc-500 block mb-1">
          Horizon: {months} months
        </label>
        <input
          type="range"
          min={1}
          max={24}
          value={months}
          onChange={(e) => onMonthsChange(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-600">
          <span>1mo</span>
          <span>12mo</span>
          <span>24mo</span>
        </div>
      </div>
    </>
  );
}
