"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, Circle } from "lucide-react";
import {
  parseNote,
  serializeNote,
  type NoteLine,
} from "@/shared/lib/note-lines";
import { cn } from "@/shared/lib/utils";

export function NoteEditor({
  value,
  onChange,
  placeholder,
  checklistLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  checklistLabel: string;
}) {
  const lines = parseNote(value);
  const refs = useRef<(HTMLInputElement | HTMLTextAreaElement | null)[]>([]);
  const focusAt = useRef<number | null>(null);
  const active = useRef(0);

  useEffect(() => {
    if (focusAt.current == null) return;
    const el = refs.current[focusAt.current];
    focusAt.current = null;
    el?.focus();
  });

  function commit(next: NoteLine[], focus?: number) {
    if (focus != null) focusAt.current = focus;
    onChange(serializeNote(next));
  }

  function update(index: number, text: string) {
    const next = lines.map((line, i) =>
      i === index ? { ...line, text } : line,
    );
    commit(next);
  }

  function toggle(index: number) {
    const line = lines[index];
    if (line.kind !== "check") return;
    const next = lines.map((item, i) =>
      i === index && item.kind === "check"
        ? { ...item, done: !item.done }
        : item,
    );
    commit(next);
  }

  function addChecklist() {
    const index = Math.min(active.current, lines.length - 1);
    const line = lines[index];
    if (line?.kind === "text") {
      const next = lines.map((item, i) =>
        i === index
          ? { kind: "check" as const, done: false, text: item.text }
          : item,
      );
      commit(next, index);
      return;
    }
    const next = [...lines];
    next.splice(index + 1, 0, { kind: "check", done: false, text: "" });
    commit(next, index + 1);
  }

  function onKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    index: number,
  ) {
    const line = lines[index];
    if (event.key === "Enter") {
      event.preventDefault();
      const insert: NoteLine =
        line.kind === "check"
          ? { kind: "check", done: false, text: "" }
          : { kind: "text", text: "" };
      const next = [...lines];
      next.splice(index + 1, 0, insert);
      commit(next, index + 1);
      return;
    }
    if (
      event.key === "Backspace" &&
      line.text === "" &&
      lines.length > 1
    ) {
      event.preventDefault();
      const next = lines.filter((_, i) => i !== index);
      commit(next, Math.max(0, index - 1));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={addChecklist}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-xs text-muted transition hover:bg-surface hover:text-ink"
        >
          <Circle className="size-3.5" />
          {checklistLabel}
        </button>
      </div>
      <div className="min-h-[280px] flex-1 space-y-0.5 overflow-y-auto">
        {lines.map((line, index) => {
          const done = line.kind === "check" && line.done;
          return (
            <div key={index} className="flex items-start gap-2">
              {line.kind === "check" ? (
                <button
                  type="button"
                  aria-pressed={done}
                  onClick={() => toggle(index)}
                  className={cn(
                    "mt-1.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border transition",
                    done
                      ? "border-accent bg-accent text-white"
                      : "border-muted/80 bg-transparent text-transparent hover:border-ink",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </button>
              ) : (
                <span className="mt-2 size-[18px] shrink-0" aria-hidden />
              )}
              {line.kind === "check" ? (
                <input
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  value={line.text}
                  onFocus={() => {
                    active.current = index;
                  }}
                  onChange={(e) => update(index, e.target.value)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  className={cn(
                    "w-full bg-transparent py-1 text-sm outline-none",
                    done && "text-muted line-through",
                  )}
                />
              ) : (
                <textarea
                  ref={(el) => {
                    refs.current[index] = el;
                    if (el) {
                      el.style.height = "0px";
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  rows={1}
                  value={line.text}
                  placeholder={index === 0 && lines.length === 1 ? placeholder : ""}
                  onFocus={() => {
                    active.current = index;
                  }}
                  onChange={(e) => {
                    update(index, e.target.value);
                    e.target.style.height = "0px";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  className="w-full resize-none overflow-hidden bg-transparent py-1 text-sm outline-none placeholder:text-muted"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
