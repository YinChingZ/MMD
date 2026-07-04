"use client";

import type { RunMode } from "@mmd/protocol";

const MODES: { value: RunMode; label: string; description: string }[] = [
  {
    value: "standard",
    label: "Standard",
    description: "Full six-phase protocol: propose, critique, revise, normalize, vote, compose.",
  },
  {
    value: "quick",
    label: "Quick",
    description: "Fewer models, skips critique/revise/vote — fastest, least scrutinized.",
  },
  {
    value: "planning",
    label: "Planning",
    description: "Splits the question into up to 8 topics, runs the full protocol per topic in parallel.",
  },
];

export function ModeSelector({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {MODES.map((mode) => (
        <label
          key={mode.value}
          className="flex items-start gap-2 rounded border border-gray-200 p-2 hover:bg-gray-50"
        >
          <input
            type="radio"
            name="mode"
            value={mode.value}
            checked={value === mode.value}
            onChange={() => onChange(mode.value)}
            className="mt-1"
          />
          <span>
            <span className="block font-medium">{mode.label}</span>
            <span className="block text-sm text-gray-500">{mode.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
