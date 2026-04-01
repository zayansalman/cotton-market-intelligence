"use client";

import { useState, useRef } from "react";
import type { Scenario } from "@/lib/scenarios/types";

interface ScenarioManagerProps {
  scenarios: Scenario[];
  onSave: () => void;
  onLoad: (scenario: Scenario) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (json: string) => void;
  onCompare: (ids: [string, string]) => void;
  canSave: boolean;
}

export default function ScenarioManager({
  scenarios,
  onSave,
  onLoad,
  onDelete,
  onRename,
  onDuplicate,
  onExport,
  onImport,
  onCompare,
  canSave,
}: ScenarioManagerProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onImport(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const toggleCompare = (id: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-xs font-semibold text-zinc-400 uppercase tracking-wider hover:text-zinc-200"
      >
        Scenarios ({scenarios.length})
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="space-y-2">
          {/* Actions */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="flex-1 text-[10px] bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded px-2 py-1 hover:bg-blue-600/30 disabled:opacity-40"
            >
              Save current
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-2 py-1 hover:text-zinc-200"
            >
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          {/* Compare button */}
          {selectedForCompare.length === 2 && (
            <button
              type="button"
              onClick={() =>
                onCompare(selectedForCompare as [string, string])
              }
              className="w-full text-[10px] bg-green-600/20 text-green-300 border border-green-500/30 rounded px-2 py-1 hover:bg-green-600/30"
            >
              Compare selected
            </button>
          )}

          {/* Scenario list */}
          {scenarios.length === 0 ? (
            <p className="text-[10px] text-zinc-600">
              No saved scenarios yet.
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className={`border rounded-md p-2 text-xs transition-colors ${
                    selectedForCompare.includes(s.id)
                      ? "border-green-500/50 bg-green-500/5"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {editingId === s.id ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onRename(s.id, editName);
                            setEditingId(null);
                          }
                        }}
                        className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-[10px] text-zinc-100 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          onRename(s.id, editName);
                          setEditingId(null);
                        }}
                        className="text-[10px] text-green-400"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-200 font-medium truncate">
                          {s.name}
                        </span>
                        <input
                          type="checkbox"
                          checked={selectedForCompare.includes(s.id)}
                          onChange={() => toggleCompare(s.id)}
                          className="accent-green-500 ml-2"
                          title="Select for comparison"
                        />
                      </div>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {new Date(s.created_at).toLocaleDateString()} —{" "}
                        {s.inputs.demand.required_tonnes.toLocaleString()}t /{" "}
                        {s.inputs.demand.planning_horizon_months}mo —{" "}
                        {s.strategy.signal}
                      </p>
                      <div className="flex gap-1.5 mt-1">
                        <button
                          onClick={() => onLoad(s)}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(s.id);
                            setEditName(s.name);
                          }}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => onDuplicate(s.id)}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Dup
                        </button>
                        <button
                          onClick={() => onExport(s.id)}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => onDelete(s.id)}
                          className="text-[10px] text-red-500 hover:text-red-400 ml-auto"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
