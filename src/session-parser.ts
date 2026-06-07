import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import type { SearchRole } from "./types.js";

export interface ExtractedTextRecord {
  role: Exclude<SearchRole, "session">;
  text: string;
  sequence: number;
  entryId?: string;
  timestamp?: string;
  cwd?: string;
  sessionName?: string;
}

export interface ParsedSession {
  sessionId: string;
  sourcePath: string;
  cwd?: string;
  sessionName?: string;
  records: ExtractedTextRecord[];
}

const TEXT_ROLES = new Set(["user", "assistant"]);
const NOISY_ROLES = new Set(["toolResult"]);
const NOISY_TYPES = new Set(["toolCall", "toolResult", "bashExecution", "thinking"]);

export async function parseSessionFile(sessionPath: string): Promise<ParsedSession> {
  const sourcePath = resolve(sessionPath);
  const records: ExtractedTextRecord[] = [];
  let sessionId = "";
  let cwd: string | undefined;
  let sessionName: string | undefined;
  let sequence = 0;

  const rl = createInterface({ input: createReadStream(sourcePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    sessionId ||= stringValue(entry.sessionId) ?? stringValue(entry.session_id) ?? "";
    cwd ||= stringValue(entry.cwd);
    sessionName ||= stringValue(entry.name) ?? stringValue(entry.sessionName) ?? stringValue(entry.session_name);

    const summary = summaryText(entry);
    if (summary) {
      records.push(baseRecord(entry, summary.role, summary.text, sequence++, cwd, sessionName));
      continue;
    }

    if (isNoisyTopLevelEntry(entry)) continue;

    const role = stringValue(entry.role);
    if (!role || !TEXT_ROLES.has(role) || NOISY_ROLES.has(role)) continue;

    for (const text of extractTextBlocks(entry.message?.content ?? entry.content)) {
      records.push(baseRecord(entry, role as "user" | "assistant", text, sequence++, cwd, sessionName));
    }
  }

  const parsed: Partial<ParsedSession> & Pick<ParsedSession, "sessionId" | "sourcePath" | "records"> = { sessionId, sourcePath, records };
  if (cwd !== undefined) parsed.cwd = cwd;
  if (sessionName !== undefined) parsed.sessionName = sessionName;
  return parsed;
}

function baseRecord(entry: any, role: Exclude<SearchRole, "session">, text: string, sequence: number, cwd?: string, sessionName?: string): ExtractedTextRecord {
  const record: ExtractedTextRecord = { role, text, sequence };
  const entryId = stringValue(entry.id) ?? stringValue(entry.entryId);
  const timestamp = stringValue(entry.timestamp) ?? stringValue(entry.createdAt);
  if (entryId !== undefined) record.entryId = entryId;
  if (timestamp !== undefined) record.timestamp = timestamp;
  if (cwd !== undefined) record.cwd = cwd;
  if (sessionName !== undefined) record.sessionName = sessionName;
  return record;
}

function summaryText(entry: any): { role: "compaction" | "branch_summary"; text: string } | undefined {
  const type = stringValue(entry.type);
  const compaction = stringValue(entry.compaction?.summary) ?? (type === "compaction" ? stringValue(entry.summary) : undefined);
  if (compaction) return { role: "compaction", text: compaction };
  const branch = stringValue(entry.branch_summary?.summary) ?? stringValue(entry.branchSummary?.summary) ?? (type === "branch_summary" ? stringValue(entry.summary) : undefined);
  if (branch) return { role: "branch_summary", text: branch };
  return undefined;
}

function isNoisyTopLevelEntry(entry: any): boolean {
  const type = stringValue(entry.type);
  return type !== undefined && NOISY_TYPES.has(type);
}

function extractTextBlocks(content: unknown): string[] {
  if (typeof content === "string") return noisyText(content) ? [] : [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (!noisyText(block)) texts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const type = stringValue((block as any).type);
    if (!type || type !== "text" || NOISY_TYPES.has(type)) continue;
    const text = stringValue((block as any).text);
    if (text && !noisyText(text)) texts.push(text);
  }
  return texts;
}

function noisyText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.length > 100 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
