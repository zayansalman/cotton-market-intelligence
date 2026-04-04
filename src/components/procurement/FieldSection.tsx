"use client";

import { useState } from "react";

interface FieldSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function FieldSection({
  title,
  children,
  defaultOpen = false,
}: FieldSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
      >
        {title}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}
