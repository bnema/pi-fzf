import { cleanCache, doctorCache, getCacheStats, rebuildCache, syncCache } from "./cache.js";
import { detectFzfVersion, runFzf } from "./fzf.js";
import { parseRecordKey } from "./records.js";
import { runSelectedAction } from "./actions.js";
import { candidateLines, findRecordByKey, highlightForQuery, previewRecord, rgCandidateLines } from "./search.js";
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
export async function main(args = process.argv.slice(2)) {
    installPipeErrorHandler();
    if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
        console.log(HELP.trimEnd());
        return;
    }
    const cmd = command(args);
    const rest = cmd === "default" ? args : args.slice(1);
    const opts = parseOptions(rest);
    if (cmd === "index") {
        console.log(JSON.stringify(opts.rebuild ? await rebuildCache() : await syncCache()));
        return;
    }
    if (cmd === "clean") {
        console.log(JSON.stringify(await cleanCache()));
        return;
    }
    if (cmd === "doctor") {
        console.log(JSON.stringify(await doctorCache(), null, 2));
        return;
    }
    if (cmd === "stats") {
        console.log(JSON.stringify(await getCacheStats(), null, 2));
        return;
    }
    if (cmd === "candidates") {
        console.log((await rgCandidateLines(opts)).join("\n"));
        return;
    }
    if (cmd === "preview") {
        await printPreview(opts.key, opts);
        return;
    }
    if (cmd === "copy") {
        await copyKey(required(opts.key, "--key"));
        return;
    }
    await syncCache();
    if (opts.noFzf) {
        await printSearch(opts);
        return;
    }
    const lines = await candidateLines(opts);
    const fzfOptions = { candidates: lines, dynamicRg: true, searchArgs: serializeSearchArgs(opts) };
    if (opts.query !== undefined)
        fzfOptions.query = opts.query;
    const version = await detectFzfVersion();
    if (version !== undefined)
        fzfOptions.version = version;
    const selected = await runFzf(fzfOptions);
    if (!selected)
        return;
    const record = await findRecordByKey(parseRecordKey(selected));
    if (!record) {
        process.exitCode = 1;
        return;
    }
    const action = actionFromOptions(opts);
    const actionOptions = {};
    if (opts.exec === true || shouldExecEnter())
        actionOptions.exec = true;
    await runSelectedAction(record, action, actionOptions);
}
async function printSearch(opts) {
    const lines = await candidateLines(opts);
    if (!opts.json && !opts.printSessionId && !opts.printSessionPath && !opts.printSnippet) {
        console.log(lines.join("\n"));
        return;
    }
    for (const line of lines) {
        const r = await findRecordByKey(parseRecordKey(line));
        if (!r)
            continue;
        if (opts.json)
            console.log(JSON.stringify(r));
        else if (opts.printSessionId)
            console.log(r.sessionId);
        else if (opts.printSessionPath)
            console.log(r.sessionPath);
        else
            console.log(r.text);
    }
}
async function printPreview(key, opts = {}) {
    if (!key || key.startsWith("--"))
        return;
    const p = await previewRecord(key, 12, opts);
    if (!p) {
        process.exitCode = 1;
        return;
    }
    console.log(p.metadata.join("\n"));
    console.log(`${opts.query ? "matches with context" : "messages"}:`);
    console.log(p.records.map((record) => `${coloredRole(record.role)} ${highlightForQuery(record.text, opts.query, opts)}`).join("\n"));
}
async function copyKey(key) { const r = await findRecordByKey(key); if (!r) {
    process.exitCode = 1;
    return;
} await runSelectedAction(r, "copy"); }
function command(args) { return ["search", "index", "clean", "doctor", "stats", "candidates", "preview", "copy"].includes(args[0] ?? "") ? args[0] : "default"; }
function parseOptions(args) {
    const o = {};
    const terms = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--json")
            o.json = true;
        else if (a === "--print-session-id")
            o.printSessionId = true;
        else if (a === "--print-session-path")
            o.printSessionPath = true;
        else if (a === "--print-snippet")
            o.printSnippet = true;
        else if (a === "--no-fzf")
            o.noFzf = true;
        else if (a === "--rebuild")
            o.rebuild = true;
        else if (a === "--exec")
            o.exec = true;
        else if (a.startsWith("--query="))
            o.query = a.slice("--query=".length);
        else if (a === "--query") {
            const next = readOptionValue(args, i, { allowLeadingDash: true });
            if (next !== undefined) {
                o.query = next.value;
                i = next.index;
            }
            else
                o.query = "";
        }
        else if (a === "--key") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.key = next.value;
                i = next.index;
            }
        }
        else if (a === "--role") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.role = next.value;
                i = next.index;
            }
        }
        else if (a === "--project") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.project = next.value;
                i = next.index;
            }
        }
        else if (a === "--cwd") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.cwd = next.value;
                i = next.index;
            }
        }
        else if (a === "--since") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.since = next.value;
                i = next.index;
            }
        }
        else if (a === "--before") {
            const next = readOptionValue(args, i);
            if (next !== undefined) {
                o.before = next.value;
                i = next.index;
            }
        }
        else if (a === "--named-only")
            o.namedOnly = true;
        else if (a === "--limit") {
            const next = readOptionValue(args, i);
            if (next === undefined)
                throw new Error("--limit requires a positive integer");
            o.limit = parsePositiveInteger(next.value, "--limit");
            i = next.index;
        }
        else if (a === "--or")
            o.tokenMode = "or";
        else if (a === "--regex")
            o.matchMode = "regex";
        else if (a === "--fixed")
            o.matchMode = "fixed";
        else
            terms.push(a);
    }
    if (o.query === undefined && terms.length)
        o.query = terms.join(" ");
    return o;
}
function parsePositiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`${name} requires a positive integer`);
    return parsed;
}
function readOptionValue(args, index, options = {}) {
    const value = args[index + 1];
    if (value === undefined || (!options.allowLeadingDash && value.startsWith("--")))
        return undefined;
    return { value, index: index + 1 };
}
function serializeSearchArgs(options) {
    const args = [];
    if (options.role)
        args.push("--role", options.role);
    if (options.project)
        args.push("--project", options.project);
    if (options.cwd)
        args.push("--cwd", options.cwd);
    if (options.since)
        args.push("--since", options.since);
    if (options.before)
        args.push("--before", options.before);
    if (options.namedOnly)
        args.push("--named-only");
    if (options.limit !== undefined)
        args.push("--limit", String(options.limit));
    if (options.tokenMode === "or")
        args.push("--or");
    if (options.matchMode === "regex")
        args.push("--regex");
    if (options.matchMode === "fixed")
        args.push("--fixed");
    return args;
}
function coloredRole(role) {
    const color = role === "user" ? "\u001b[36;1m" : role === "assistant" ? "\u001b[32;1m" : role === "compaction" ? "\u001b[35;1m" : "\u001b[33;1m";
    return `[${color}${role}\u001b[0m]`;
}
function actionFromOptions(o) {
    if (o.json)
        return "json";
    if (o.printSessionId)
        return "print-session-id";
    if (o.printSessionPath)
        return "print-session-path";
    if (o.printSnippet)
        return "print-snippet";
    const enter = process.env.PI_FZF_ENTER;
    if (enter === "exec")
        return "resume";
    if (enter === "path")
        return "print-session-path";
    if (enter === "id")
        return "print-session-id";
    if (enter === "json")
        return "json";
    if (process.env.PI_FZF_ACTION)
        return process.env.PI_FZF_ACTION;
    return "resume";
}
function shouldExecEnter() { return process.env.PI_FZF_ENTER === "exec"; }
function required(v, name) { if (!v)
    throw new Error(`${name} is required`); return v; }
function installPipeErrorHandler() {
    if (pipeErrorHandlerInstalled)
        return;
    pipeErrorHandlerInstalled = true;
    process.stdout.on("error", (error) => {
        if (error.code === "EPIPE")
            process.exit(0);
        throw error;
    });
}
//# sourceMappingURL=cli.js.map