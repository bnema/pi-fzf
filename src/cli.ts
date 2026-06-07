import { cleanCache, doctorCache, getCacheStats, rebuildCache, syncCache } from "./cache.js";
import { detectFzfVersion, runFzf } from "./fzf.js";
import { parseRecordKey } from "./records.js";
import { runSelectedAction, type SelectedAction } from "./actions.js";
import { candidateLines, findRecordByKey, highlightForQuery, previewRecord, rgCandidateLines, type SearchOptions } from "./search.js";

const HELP = `pi-fzf

Search previous Pi sessions with rg and fzf.

Usage:
  pi-fzf [query...]
  pi-fzf search [query...] [--json|--print-session-id|--print-session-path|--print-snippet] [--no-fzf]
  pi-fzf index [--rebuild]
  pi-fzf clean | doctor | stats
  pi-fzf candidates --query <query>
  pi-fzf preview --key <key>
  pi-fzf copy --key <key>
`;

let pipeErrorHandlerInstalled = false;

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  installPipeErrorHandler();
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") { console.log(HELP.trimEnd()); return; }
  const cmd = command(args);
  const rest = cmd === "default" ? args : args.slice(1);
  const opts = parseOptions(rest);

  if (cmd === "index") { console.log(JSON.stringify(opts.rebuild ? await rebuildCache() : await syncCache())); return; }
  if (cmd === "clean") { console.log(JSON.stringify(await cleanCache())); return; }
  if (cmd === "doctor") { console.log(JSON.stringify(await doctorCache(), null, 2)); return; }
  if (cmd === "stats") { console.log(JSON.stringify(await getCacheStats(), null, 2)); return; }
  if (cmd === "candidates") { console.log((await rgCandidateLines(opts)).join("\n")); return; }
  if (cmd === "preview") { await printPreview(opts.key, opts); return; }
  if (cmd === "copy") { await copyKey(required(opts.key, "--key")); return; }

  await syncCache();
  if (opts.noFzf) { await printSearch(opts); return; }
  const lines = await candidateLines(opts);
  const fzfOptions: Parameters<typeof runFzf>[0] = { candidates: lines, dynamicRg: true };
  if (opts.query !== undefined) fzfOptions.query = opts.query;
  const version = await detectFzfVersion();
  if (version !== undefined) fzfOptions.version = version;
  const selected = await runFzf(fzfOptions);
  if (!selected) return;
  const record = await findRecordByKey(parseRecordKey(selected));
  if (!record) { process.exitCode = 1; return; }
  await runSelectedAction(record, actionFromOptions(opts));
}

async function printSearch(opts: CliOptions) {
  const lines = await candidateLines(opts);
  if (!opts.json && !opts.printSessionId && !opts.printSessionPath && !opts.printSnippet) { console.log(lines.join("\n")); return; }
  for (const line of lines) {
    const r = await findRecordByKey(parseRecordKey(line));
    if (!r) continue;
    if (opts.json) console.log(JSON.stringify(r));
    else if (opts.printSessionId) console.log(r.sessionId);
    else if (opts.printSessionPath) console.log(r.sessionPath);
    else console.log(r.text);
  }
}

async function printPreview(key: string | undefined, opts: CliOptions = {}) {
  if (!key || key.startsWith("--")) return;
  const p = await previewRecord(key, 12, opts);
  if (!p) { process.exitCode = 1; return; }
  console.log(p.metadata.join("\n"));
  console.log(`${opts.query ? "matches with context" : "messages"}:`);
  console.log(p.records.map((record) => `[${record.role}] ${highlightForQuery(record.text, opts.query, opts)}`).join("\n"));
}
async function copyKey(key: string) { const r = await findRecordByKey(key); if (!r) { process.exitCode = 1; return; } await runSelectedAction(r, "copy"); }

type Command = "default" | "search" | "index" | "clean" | "doctor" | "stats" | "candidates" | "preview" | "copy";
interface CliOptions extends SearchOptions { json?: boolean; printSessionId?: boolean; printSessionPath?: boolean; printSnippet?: boolean; noFzf?: boolean; rebuild?: boolean; key?: string }
function command(args: string[]): Command { return ["search","index","clean","doctor","stats","candidates","preview","copy"].includes(args[0] ?? "") ? args[0] as Command : "default"; }
function parseOptions(args: string[]): CliOptions {
  const o: CliOptions = {}; const terms: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") o.json = true; else if (a === "--print-session-id") o.printSessionId = true;
    else if (a === "--print-session-path") o.printSessionPath = true; else if (a === "--print-snippet") o.printSnippet = true;
    else if (a === "--no-fzf") o.noFzf = true; else if (a === "--rebuild") o.rebuild = true;
    else if (a === "--query") { const next = readOptionValue(args, i); if (next !== undefined) { o.query = next.value; i = next.index; } else o.query = ""; }
    else if (a === "--key") { const next = readOptionValue(args, i); if (next !== undefined) { o.key = next.value; i = next.index; } }
    else if (a === "--role") { const next = readOptionValue(args, i); if (next !== undefined) { o.role = next.value as any; i = next.index; } } else if (a === "--project") { const next = readOptionValue(args, i); if (next !== undefined) { o.project = next.value; i = next.index; } }
    else if (a === "--cwd") { const next = readOptionValue(args, i); if (next !== undefined) { o.cwd = next.value; i = next.index; } } else if (a === "--since") { const next = readOptionValue(args, i); if (next !== undefined) { o.since = next.value; i = next.index; } } else if (a === "--before") { const next = readOptionValue(args, i); if (next !== undefined) { o.before = next.value; i = next.index; } }
    else if (a === "--named-only") o.namedOnly = true; else if (a === "--limit") o.limit = Number(args[++i]);
    else if (a === "--or") o.tokenMode = "or"; else if (a === "--regex") o.matchMode = "regex"; else if (a === "--fixed") o.matchMode = "fixed";
    else terms.push(a);
  }
  if (o.query === undefined && terms.length) o.query = terms.join(" ");
  return o;
}
function readOptionValue(args: string[], index: number): { value: string; index: number } | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return { value, index: index + 1 };
}

function actionFromOptions(o: CliOptions): SelectedAction { if (o.json) return "json"; if (o.printSessionId) return "print-session-id"; if (o.printSessionPath) return "print-session-path"; if (o.printSnippet) return "print-snippet"; return (process.env.PI_FZF_ACTION as SelectedAction | undefined) ?? "menu"; }
function required(v: string | undefined, name: string): string { if (!v) throw new Error(`${name} is required`); return v; }
function installPipeErrorHandler(): void {
  if (pipeErrorHandlerInstalled) return;
  pipeErrorHandlerInstalled = true;
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}
