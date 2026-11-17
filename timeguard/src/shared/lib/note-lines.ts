export type NoteLine =
  | { kind: "text"; text: string }
  | { kind: "check"; done: boolean; text: string };

const CHECK = /^\[( |x)\] (.*)$/;

export function parseNote(body: string): NoteLine[] {
  if (!body) return [{ kind: "text", text: "" }];
  return body.split("\n").map((line) => {
    const m = line.match(CHECK);
    if (!m) return { kind: "text", text: line };
    return { kind: "check", done: m[1] === "x", text: m[2] };
  });
}

export function serializeNote(lines: NoteLine[]): string {
  if (
    lines.length === 1 &&
    lines[0].kind === "text" &&
    lines[0].text === ""
  ) {
    return "";
  }
  return lines
    .map((line) =>
      line.kind === "check"
        ? `[${line.done ? "x" : " "}] ${line.text}`
        : line.text,
    )
    .join("\n");
}

export function notePreview(body: string): string {
  const line = body
    .split("\n")
    .map((raw) => raw.replace(/^\[( |x)\] /, "").trim())
    .find(Boolean);
  return line || "";
}
