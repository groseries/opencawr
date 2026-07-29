import type { ReactNode } from "react";

/**
 * Minimal markdown-subset parser/renderer for the Assumptions tab (R6).
 *
 * Deliberately narrow scope: headings, GFM pipe tables, unordered (-/*) and
 * ordered (N.) lists with lazy continuation lines, fenced code blocks (```),
 * paragraphs, and inline `code`, **bold**, and [text](url) links. No italics,
 * no nested emphasis, no blockquotes, no HTML passthrough — the three source
 * docs this renders (ASSUMPTIONS.md, docs/reliability-methodology.md,
 * OpenCAWR_SPEC.md) don't use more than this, and this is a renderer for
 * those docs, not a general-purpose markdown engine.
 *
 * One known cosmetic gap: single-asterisk italics (`*word*`, used a couple of
 * times in ASSUMPTIONS.md, e.g. "*Electric Power Monthly*") render as literal
 * asterisks — not in the brief's requested feature set (headings, tables,
 * lists, inline code, links, bold), so left out rather than scope-crept in.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "p"; text: string };

const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;

/** Split one markdown table row into cells. Handles `\|` (escaped literal
 *  pipe — GFM's own convention for a pipe that must NOT split the cell) and
 *  pipes inside `` `code` `` spans, both of which appear for real in
 *  ASSUMPTIONS.md (e.g. `` `minSeats: number \| null` `` in §G) — a naive
 *  split on every `|` would shear that cell in two. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") {
      inCode = !inCode;
      cur += c;
      continue;
    }
    if (c === "|" && !inCode) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur);
  // GFM rows conventionally open/close with `|`; drop the empty leading/
  // trailing cells that produces rather than requiring every row to omit them.
  if (cells.length && cells[0]!.trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && SEP_RE.test(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const ul = UL_RE.exec(line);
    const ol = OL_RE.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items: string[] = [];
      let cur = (ul ? ul[1] : ol![1])!;
      i++;
      for (;;) {
        const l = i < lines.length ? lines[i] : undefined;
        if (l === undefined || l.trim() === "") break;
        const nul = UL_RE.exec(l);
        const nol = OL_RE.exec(l);
        if (ordered ? nol : nul) {
          items.push(cur);
          cur = (nul ? nul[1] : nol![1])!;
          i++;
        } else if (/^\s{2,}\S/.test(l)) {
          // lazy continuation line of the current item
          cur += " " + l.trim();
          i++;
        } else {
          break;
        }
      }
      items.push(cur);
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !HEADING_RE.test(lines[i]!) &&
      !UL_RE.test(lines[i]!) &&
      !OL_RE.test(lines[i]!) &&
      !lines[i]!.trim().startsWith("```")
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

/** Find a table row anywhere in `source` whose first cell equals `firstCell`
 *  exactly (trimmed). Used to quote a specific ledger row (e.g. "Energy")
 *  without retyping its text. */
export function findRow(source: string, firstCell: string): string[] | null {
  for (const b of parseMarkdown(source)) {
    if (b.kind === "table") {
      for (const row of b.rows) {
        if (row[0]?.trim() === firstCell) return row;
      }
    }
  }
  return null;
}

/** Every table row anywhere in `source` whose first cell is literally "OPEN",
 *  tagged with the nearest preceding heading. Ledger rows use this shorthand
 *  regardless of the table's own header shape (some are 3-cell, some 4-cell). */
export function findOpenRows(source: string): { heading: string; cells: string[] }[] {
  const out: { heading: string; cells: string[] }[] = [];
  let heading = "";
  for (const b of parseMarkdown(source)) {
    if (b.kind === "heading") heading = b.text;
    if (b.kind === "table") {
      for (const row of b.rows) {
        if (row[0]?.trim() === "OPEN") out.push({ heading, cells: row.slice(1) });
      }
    }
  }
  return out;
}

/** Slice out one `## N. Heading` section (up to but excluding the next given
 *  heading), so callers can quote a specific spec section instead of the
 *  whole document. Matched by substring, not line number, so a future edit
 *  to the source file doesn't silently desync the slice. */
export function sliceSection(source: string, startHeading: string, endHeading: string): string {
  const start = source.indexOf(startHeading);
  if (start === -1) return `_(section "${startHeading}" not found — check for a heading rename)_`;
  const end = source.indexOf(endHeading, start + startHeading.length);
  return source.slice(start, end === -1 ? undefined : end).trim();
}

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<code key={`${keyPrefix}-${n++}`}>{m[1]}</code>);
    } else if (m[2] !== undefined) {
      out.push(<strong key={`${keyPrefix}-${n++}`}>{m[2]}</strong>);
    } else {
      out.push(
        <a key={`${keyPrefix}-${n++}`} href={m[4]} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      );
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render one string with the same inline rules (code/bold/links) used
 *  inside blocks — for callouts that quote a single ledger cell/sentence
 *  rather than a whole document. */
export function MarkdownInline({ text }: { text: string }) {
  return <>{renderInline(text, "inline")}</>;
}

const STATUS_TOKEN_RE = /\b(SOURCED|DOCUMENTED|JUDGMENT|USER-SPECIFIC|OWNER DECISION)\b/g;
const STATUS_SLUG: Record<string, string> = {
  SOURCED: "sourced",
  DOCUMENTED: "documented",
  JUDGMENT: "judgment",
  "USER-SPECIFIC": "user-specific",
  "OWNER DECISION": "owner-decision",
};

/** Status-column cells are plain uppercase tokens (no markdown formatting in
 *  practice) — wrap each recognized status word in a scannable badge instead
 *  of running the generic inline parser on them. */
function renderStatusCell(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  STATUS_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATUS_TOKEN_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[1]!;
    out.push(
      <span key={`${keyPrefix}-${n++}`} className={`status-badge status-${STATUS_SLUG[token]}`}>
        {token}
      </span>,
    );
    last = STATUS_TOKEN_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case "heading": {
      const content = renderInline(b.text, `h${key}`);
      const lvl = Math.min(b.level + 2, 6);
      if (lvl === 3) return <h3 key={key}>{content}</h3>;
      if (lvl === 4) return <h4 key={key}>{content}</h4>;
      if (lvl === 5) return <h5 key={key}>{content}</h5>;
      return <h6 key={key}>{content}</h6>;
    }
    case "p":
      return <p key={key}>{renderInline(b.text, `p${key}`)}</p>;
    case "list": {
      const items = b.items.map((it, idx) => <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>);
      return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "code":
      return (
        <pre key={key}>
          <code>{b.text}</code>
        </pre>
      );
    case "table": {
      const statusCol = b.header.findIndex((h) => h.trim() === "Status");
      return (
        <div className="md-table-wrap" key={key}>
          <table>
            <thead>
              <tr>
                {b.header.map((h, idx) => (
                  <th key={idx}>{renderInline(h, `th${key}-${idx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      {ci === statusCol
                        ? renderStatusCell(cell, `td${key}-${ri}-${ci}`)
                        : renderInline(cell, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
