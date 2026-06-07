import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { copyText } from "../src/actions.js";
import { doctorCache, getCacheStats, syncCache } from "../src/cache.js";
import { detectFzfVersion, runFzf } from "../src/fzf.js";
import { parseRecordKey, recordKey } from "../src/records.js";
import { findRecordByKey, searchRecords, type SearchOptions } from "../src/search.js";
import type { CandidateRecord } from "../src/records.js";

type ParsedCommand =
  | { kind: "search"; query?: string; external: boolean }
  | { kind: "index" | "stats" | "doctor" };

const SESSION_LIMIT = 10_000;
const VISIBLE_ROWS = 20;
const PREVIEW_ROWS = 5;

export default function piFzfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("fzf", {
    description: "Search previous Pi sessions.",
    async handler(args, ctx) {
      await ctx.waitForIdle();
      const parsed = parseFzfArgs(args);
      switch (parsed.kind) {
        case "index": return showObject(ctx, "pi-fzf index", await syncCache());
        case "stats": return showObject(ctx, "pi-fzf stats", await getCacheStats());
        case "doctor": return showObject(ctx, "pi-fzf doctor", await doctorCache());
        case "search": return runSearchCommand(pi, ctx, parsed);
      }
    }
  });
}

async function runSearchCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, parsed: Extract<ParsedCommand, { kind: "search" }>): Promise<void> {
  await syncCache();
  const searchOptions: SearchOptions = { limit: SESSION_LIMIT };

  if (parsed.external) {
    const safe = ctx.mode === "print" && process.stdin.isTTY && process.stdout.isTTY;
    if (safe) {
      const selected = await runExternal(parsed.query === undefined ? searchOptions : { ...searchOptions, query: parsed.query });
      if (!selected) return;
      return actOnRecord(pi, ctx, selected);
    }
    ctx.ui.notify("/fzf --external cannot safely take over the terminal from this Pi UI; using the native selector instead.", "warning");
  }

  const records = await nativeRecords(searchOptions, parsed.query);
  if (records.length === 0) {
    ctx.ui.notify("No pi-fzf sessions indexed yet. Run /fzf index first if needed.", "info");
    return;
  }

  const initialQuery = parsed.query ?? "";
  if (!ctx.hasUI) {
    const first = sessionResults(records, initialQuery)[0];
    if (first) showRecord(ctx, first);
    else ctx.ui.notify(`No pi-fzf results for ${JSON.stringify(initialQuery)}.`, "info");
    return;
  }

  const selected = ctx.mode === "tui"
    ? await runNativeSearchPicker(ctx, records, initialQuery)
    : await runSimpleSearchPicker(ctx, records, initialQuery);
  if (selected) await actOnRecord(pi, ctx, selected);
}

async function nativeRecords(options: SearchOptions, query: string | undefined): Promise<CandidateRecord[]> {
  if (!query?.trim()) return searchRecords(options);
  const [recent, matching] = await Promise.all([
    searchRecords(options),
    searchRecords({ ...options, query }),
  ]);
  const byKey = new Map<string, CandidateRecord>();
  for (const record of [...matching, ...recent]) byKey.set(recordKey(record), record);
  return [...byKey.values()];
}

async function runExternal(options: SearchOptions): Promise<CandidateRecord | undefined> {
  const lines = (await searchRecords(options)).map((record) => `${record.sourceKey}:${record.sequence}:${record.chunkIndex}\t${resultLabel(record)}`);
  const fzfOptions: Parameters<typeof runFzf>[0] = { candidates: lines };
  if (options.query !== undefined) fzfOptions.query = options.query;
  const version = await detectFzfVersion();
  if (version !== undefined) fzfOptions.version = version;
  const selected = await runFzf(fzfOptions);
  if (!selected) return undefined;
  return findRecordByKey(parseRecordKey(selected));
}

async function runSimpleSearchPicker(ctx: ExtensionCommandContext, records: CandidateRecord[], query: string): Promise<CandidateRecord | undefined> {
  const visible = sessionResults(records, query);
  if (visible.length === 0) {
    ctx.ui.notify(`No pi-fzf results for ${JSON.stringify(query)}.`, "info");
    return undefined;
  }
  const labels = new Map<string, CandidateRecord>();
  const choices = visible.map((record, index) => {
    const label = `${index + 1}. ${stripAnsi(resultLabel(record))}`;
    labels.set(label, record);
    return label;
  });
  const choice = await ctx.ui.select("Search Pi sessions", choices);
  return choice ? labels.get(choice) : undefined;
}

async function runNativeSearchPicker(ctx: ExtensionCommandContext, records: CandidateRecord[], initialQuery: string): Promise<CandidateRecord | undefined> {
  return ctx.ui.custom<CandidateRecord | undefined>((tui, theme, keybindings, done) => {
    return new PiFzfPicker(records, initialQuery, keybindings, () => tui.requestRender(), done, theme);
  }, {
    overlay: true,
    overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center" },
  });
}

export class PiFzfPicker {
  private query: string;
  private selected = 0;
  private offset = 0;
  private cachedQuery: string | undefined;
  private cachedResults: CandidateRecord[] = [];

  constructor(
    private readonly records: CandidateRecord[],
    initialQuery: string,
    private readonly keybindings: { matches(data: string, id: string): boolean },
    private readonly requestRender: () => void,
    private readonly done: (record: CandidateRecord | undefined) => void,
    private readonly theme: { fg?(color: string, text: string): string; bg?(color: string, text: string): string },
  ) {
    this.query = initialQuery;
  }

  handleInput(data: string): void {
    const beforeQuery = this.query;
    if (this.keybindings.matches(data, "tui.select.up")) this.move(-1);
    else if (this.keybindings.matches(data, "tui.select.down")) this.move(1);
    else if (this.keybindings.matches(data, "tui.select.pageUp")) this.move(-VISIBLE_ROWS);
    else if (this.keybindings.matches(data, "tui.select.pageDown")) this.move(VISIBLE_ROWS);
    else if (this.keybindings.matches(data, "tui.select.confirm") || data === "\n") this.done(this.results()[this.selected]);
    else if (this.keybindings.matches(data, "tui.select.cancel")) this.done(undefined);
    else if (data === "\x7f" || data === "\b") this.query = this.query.slice(0, -1);
    else if (data === "\x15") this.query = "";
    else if (isPrintable(data)) this.query += data;

    if (this.query !== beforeQuery) {
      this.selected = 0;
      this.offset = 0;
      this.cachedQuery = undefined;
    }
    this.requestRender();
  }

  render(width: number): string[] {
    const frameWidth = Math.max(20, width);
    const innerWidth = Math.max(10, frameWidth - 4);
    const results = this.results();
    this.clampSelection(results.length);
    this.ensureVisible();
    const body = results.slice(this.offset, this.offset + VISIBLE_ROWS);
    const selectedRecord = results[this.selected];
    const content = [
      this.padLine(innerWidth, this.accent("pi-fzf session search")),
      this.padLine(innerWidth, `query: ${this.query}${this.dim("▌")}`),
      this.padLine(innerWidth, `${results.length} session${results.length === 1 ? "" : "s"} · type to filter · ↑/↓ move · PgUp/PgDn page · Enter select · Esc cancel · Ctrl-U clear`),
      this.rule(innerWidth),
    ];
    if (body.length === 0) content.push(this.padLine(innerWidth, this.dim("No matching sessions.")));
    for (let i = 0; i < body.length; i++) {
      const absolute = this.offset + i;
      const record = body[i]!;
      const prefix = absolute === this.selected ? "› " : "  ";
      const text = this.resultLine(record, prefix, innerWidth);
      content.push(this.padLine(innerWidth, absolute === this.selected ? this.selectedStyle(text) : text));
    }
    if (selectedRecord) {
      content.push(this.rule(innerWidth));
      content.push(this.padLine(innerWidth, this.accent("preview")));
      for (const line of this.previewLines(selectedRecord, innerWidth)) content.push(this.padLine(innerWidth, line));
    }
    return this.frame(content, frameWidth);
  }

  invalidate(): void { /* render is computed from current state */ }

  private results(): CandidateRecord[] {
    if (this.cachedQuery === this.query) return this.cachedResults;
    this.cachedQuery = this.query;
    this.cachedResults = sessionResults(this.records, this.query);
    return this.cachedResults;
  }

  private move(delta: number): void {
    const count = this.results().length;
    if (count === 0) return;
    this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
  }

  private clampSelection(count: number): void {
    if (count === 0) { this.selected = 0; this.offset = 0; return; }
    this.selected = Math.max(0, Math.min(count - 1, this.selected));
  }

  private ensureVisible(): void {
    if (this.selected < this.offset) this.offset = this.selected;
    if (this.selected >= this.offset + VISIBLE_ROWS) this.offset = this.selected - VISIBLE_ROWS + 1;
  }

  private frame(lines: string[], width: number): string[] {
    const innerWidth = Math.max(10, width - 4);
    const top = `╭─ ${this.accent("/fzf")} ${"─".repeat(Math.max(0, innerWidth - 5))}╮`;
    const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
    return [top, ...lines.map((line) => `│ ${line} │`), bottom];
  }

  private rule(width: number): string { return this.dim("─".repeat(width)); }
  private padLine(width: number, text: string): string {
    const truncated = this.truncatePlain(text, width);
    return truncated + " ".repeat(Math.max(0, width - visibleLength(truncated)));
  }
  private resultLine(record: CandidateRecord, prefix: string, width: number): string {
    const path = this.accent(projectPathLabel(record));
    const meta = this.dim(`${record.role} · ${formatDate(record.timestamp)}`);
    const separator = this.dim(" · ");
    const head = `${prefix}${path}${separator}${meta}${separator}`;
    const snippetWidth = Math.max(20, width - visibleLength(head));
    return `${head}${this.truncatePlain(oneLine(record.text), snippetWidth)}`;
  }
  private previewLines(record: CandidateRecord, width: number): string[] {
    const label = (name: string, value: string) => `${this.dim(`${name}:`)} ${value}`;
    const metadata = [
      label("path", this.accent(projectPathLabel(record))),
      label("date", this.dim(formatDate(record.timestamp))),
      label("session", this.dim(shortSessionId(record.sessionId))),
    ];
    const snippet = this.dim(this.truncatePlain(oneLine(record.text), width));
    return [...metadata, snippet].slice(0, PREVIEW_ROWS).map((line) => this.truncatePlain(line, width));
  }
  private truncatePlain(text: string, width: number): string { return truncate(text, Math.max(10, width)); }
  private dim(text: string): string { return this.theme.fg?.("muted", text) ?? text; }
  private accent(text: string): string { return this.theme.fg?.("accent", text) ?? text; }
  private selectedStyle(text: string): string { return this.theme.bg?.("selectedBg", text) ?? this.accent(text); }
}

async function actOnRecord(pi: ExtensionAPI, ctx: ExtensionCommandContext, record: CandidateRecord): Promise<void> {
  const reference = sessionReference(record);
  const actions = [
    "Insert session reference",
    "Send snippet to current session",
    "Switch/resume session",
    "Copy/show path/id",
    "Cancel"
  ];
  const action = ctx.hasUI ? await ctx.ui.select("pi-fzf action", actions) : "Copy/show path/id";
  if (!action || action === "Cancel") return;
  if (action === "Insert session reference") {
    const current = ctx.ui.getEditorText();
    ctx.ui.setEditorText(current ? `${current}\n${reference}` : reference);
    ctx.ui.notify("Inserted pi-fzf session reference into the editor.", "info");
    return;
  }
  if (action === "Send snippet to current session") {
    pi.sendUserMessage(`Referenced Pi session snippet:\n\n${reference}\n\n${record.text}`);
    return;
  }
  if (action === "Switch/resume session") {
    await ctx.switchSession(record.sessionPath, { withSession: async (nextCtx) => { nextCtx.ui.notify("Switched to pi-fzf result session.", "info"); } });
    return;
  }
  await copyText(reference);
  ctx.ui.notify(`Session reference copied or printed: ${record.sessionId}`, "info");
}

export function sessionResults(records: CandidateRecord[], query: string): CandidateRecord[] {
  const groups = new Map<string, CandidateRecord[]>();
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const record of records) {
    if (tokens.length > 0) {
      const haystack = `${record.sessionName ?? ""} ${record.cwd ?? ""} ${record.sessionId} ${record.display} ${record.searchText} ${record.text}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) continue;
    }
    const group = groups.get(record.sourceKey) ?? [];
    group.push(record);
    groups.set(record.sourceKey, group);
  }
  return [...groups.values()].map(bestRecord).sort(compareRecordRecencyDesc);
}

export function parseFzfArgs(args: string): ParsedCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === "index" || first === "stats" || first === "doctor") return { kind: first };
  const external = parts.includes("--external");
  const query = parts.filter((part) => part !== "--external").join(" ").trim();
  return query ? { kind: "search", query, external } : { kind: "search", external };
}

function resultLabel(record: CandidateRecord): string {
  return `${projectPathLabel(record)} · ${record.role} · ${formatDate(record.timestamp)} · ${oneLine(record.text || record.display)}`;
}

function sessionReference(record: CandidateRecord): string {
  return `pi session ${record.sessionId}\nproject: ${record.sessionName ?? projectFromCwd(record.cwd) ?? "unknown"}\nrole: ${record.role}\ndate: ${record.timestamp ?? "unknown"}`;
}

function projectFromCwd(cwd: string | undefined): string | undefined {
  return cwd?.split(/[\\/]/).filter(Boolean).pop();
}

function showRecord(ctx: ExtensionCommandContext, record: CandidateRecord): void {
  ctx.ui.notify(sessionReference(record), "info");
}

function showObject(ctx: ExtensionCommandContext, title: string, value: unknown): void {
  ctx.ui.notify(`${title}: ${JSON.stringify(value, null, 2)}`, "info");
}

function formatDate(timestamp: string | undefined): string {
  const relative = relativeDateLabel(timestamp);
  const absolute = absoluteDateLabel(timestamp);
  if (relative && absolute) return `${relative} (${absolute})`;
  return relative ?? absolute ?? "unknown date";
}

function absoluteDateLabel(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 19);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function relativeDateLabel(timestamp: string | undefined): string | undefined {
  const ms = timestampMs(timestamp);
  if (!Number.isFinite(ms)) return timestamp?.slice(0, 10);
  const diffMs = ms - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  const format = (value: number, unit: string) => {
    const rounded = Math.round(value);
    const suffix = Math.abs(rounded) === 1 ? unit : `${unit}s`;
    return rounded < 0 ? `${Math.abs(rounded)} ${suffix} ago` : `in ${rounded} ${suffix}`;
  };
  if (absMs < minute) return "just now";
  if (absMs < hour) return format(diffMs / minute, "minute");
  if (absMs < day) return format(diffMs / hour, "hour");
  if (absMs < month) return format(diffMs / day, "day");
  if (absMs < year) return format(diffMs / month, "month");
  return format(diffMs / year, "year");
}

function projectPathLabel(record: CandidateRecord): string {
  return record.cwd ?? record.sessionName ?? "unknown project";
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function bestRecord(records: CandidateRecord[]): CandidateRecord {
  if (records.length === 0) throw new Error("bestRecord called with empty array");
  return [...records].sort(compareRecordRecencyDesc)[0]!;
}

function compareRecordRecencyDesc(a: CandidateRecord, b: CandidateRecord): number {
  const timestampDelta = timestampMs(b.timestamp) - timestampMs(a.timestamp);
  if (timestampDelta !== 0) return timestampDelta;
  return b.sequence - a.sequence || b.chunkIndex - a.chunkIndex;
}

function timestampMs(timestamp: string | undefined): number {
  if (!timestamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

function truncate(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let visible = 0;
  let out = "";
  for (let index = 0; index < text.length && visible < width - 1;) {
    const ansi = /^\u001b\[[0-9;]*m/.exec(text.slice(index));
    if (ansi) {
      out += ansi[0];
      index += ansi[0].length;
      continue;
    }
    out += text[index];
    index++;
    visible++;
  }
  return `${out}…`;
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
