import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { copyText } from "../src/actions.js";
import { doctorCache, getCacheStats, syncCache } from "../src/cache.js";
import { detectFzfVersion, runFzf } from "../src/fzf.js";
import { parseRecordKey } from "../src/records.js";
import { findRecordByKey, searchRecords, type SearchOptions } from "../src/search.js";
import type { CandidateRecord } from "../src/records.js";

type ParsedCommand =
  | { kind: "search"; query?: string; external: boolean }
  | { kind: "index" | "stats" | "doctor" };

const NATIVE_LIMIT = 150;
const HARD_LIMIT = NATIVE_LIMIT + 1;

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
  const searchOptions: SearchOptions = { limit: HARD_LIMIT };
  if (parsed.query !== undefined) searchOptions.query = parsed.query;

  if (parsed.external) {
    const safe = ctx.mode === "print" && process.stdin.isTTY && process.stdout.isTTY;
    if (safe) {
      const selected = await runExternal(searchOptions);
      if (!selected) return;
      return actOnRecord(pi, ctx, selected);
    }
    ctx.ui.notify("/fzf --external cannot safely take over the terminal from this Pi UI; using the native selector instead.", "warning");
  }

  const records = await searchRecords(searchOptions);
  const truncated = records.length > NATIVE_LIMIT;
  const visible = records.slice(0, NATIVE_LIMIT);
  if (visible.length === 0) {
    ctx.ui.notify("No pi-fzf results found.", "info");
    return;
  }
  if (truncated) ctx.ui.notify(`Showing first ${NATIVE_LIMIT} results. Refine your query to see more.`, "warning");

  if (!ctx.hasUI) {
    showRecord(ctx, visible[0]!);
    return;
  }

  const labels = new Map<string, CandidateRecord>();
  const choices = visible.map((record, index) => {
    const label = `${index + 1}. ${resultLabel(record)}`;
    labels.set(label, record);
    return label;
  });
  const choice = await ctx.ui.select("Search Pi sessions", choices);
  if (!choice) return;
  const record = labels.get(choice);
  if (record) await actOnRecord(pi, ctx, record);
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

function parseFzfArgs(args: string): ParsedCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === "index" || first === "stats" || first === "doctor") return { kind: first };
  const external = parts.includes("--external");
  const query = parts.filter((part) => part !== "--external").join(" ").trim();
  return query ? { kind: "search", query, external } : { kind: "search", external };
}

function resultLabel(record: CandidateRecord): string {
  return `${record.sessionName ?? record.cwd ?? "unknown project"} · ${record.role} · ${formatDate(record.timestamp)} · ${oneLine(record.display || record.text)}`;
}

function sessionReference(record: CandidateRecord): string {
  return `pi session ${record.sessionId}\npath: ${record.sessionPath}\nrole: ${record.role}\ndate: ${record.timestamp ?? "unknown"}`;
}

function showRecord(ctx: ExtensionCommandContext, record: CandidateRecord): void {
  ctx.ui.notify(sessionReference(record), "info");
}

function showObject(ctx: ExtensionCommandContext, title: string, value: unknown): void {
  ctx.ui.notify(`${title}: ${JSON.stringify(value, null, 2)}`, "info");
}

function formatDate(timestamp: string | undefined): string {
  if (!timestamp) return "unknown date";
  return timestamp.slice(0, 10);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}
