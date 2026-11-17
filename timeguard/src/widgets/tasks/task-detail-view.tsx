import type { ReactNode } from "react";

const TOKEN = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  const parts = text.split(TOKEN);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return <s key={index}>{part.slice(2, -2)}</s>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

/** Small markdown: ## heading, **bold**, *italic*, ~~strike~~. */
export function TaskDetailView({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  if (compact) {
    const flat = text.replace(/\r\n/g, "\n").replace(/^## /gm, "").replace(/\n+/g, " ");
    return <span>{inline(flat)}</span>;
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const heading = lines.every((line) => line.startsWith("## ")) || lines[0]?.startsWith("## ");
        if (lines.length === 1 && lines[0]?.startsWith("## ")) {
          return (
            <h4 key={index} className="font-display text-lg font-medium text-ink">
              {inline(lines[0].slice(3))}
            </h4>
          );
        }
        if (heading && lines[0]?.startsWith("## ")) {
          return (
            <div key={index}>
              <h4 className="font-display text-lg font-medium text-ink">{inline(lines[0].slice(3))}</h4>
              {lines.slice(1).some(Boolean) ? (
                <p className="mt-1">{lines.slice(1).map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {inline(line)}
                  </span>
                ))}</p>
              ) : null}
            </div>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
