export default function MetricCard({
  label,
  value,
  delta,
  deltaColor,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: "green" | "red" | "neutral";
}) {
  const color =
    deltaColor === "green"
      ? "text-emerald-400"
      : deltaColor === "red"
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xl font-semibold text-zinc-100 mt-1">{value}</p>
      {delta && <p className={`text-sm mt-1 ${color}`}>{delta}</p>}
    </div>
  );
}
