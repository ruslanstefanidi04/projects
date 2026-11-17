"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  emoji?: string;
  swatch?: string;
};

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          {current?.emoji ? <span aria-hidden>{current.emoji}</span> : null}
          {current?.swatch ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: current.swatch }}
            />
          ) : null}
          <span className="truncate">{current?.label ?? value}</span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-edge bg-panel p-1 shadow-soft"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                    active
                      ? "bg-accent/15 text-ink"
                      : "text-ink hover:bg-surface",
                  )}
                >
                  {o.emoji ? <span aria-hidden>{o.emoji}</span> : null}
                  {o.swatch ? (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: o.swatch }}
                    />
                  ) : null}
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
