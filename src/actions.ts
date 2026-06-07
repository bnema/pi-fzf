import { spawn } from "node:child_process";
import type { CandidateRecord } from "./records.js";

export type SelectedAction = "menu" | "print-session-id" | "print-session-path" | "print-snippet" | "json" | "copy" | "resume" | "fork";

export interface ActionOptions { exec?: boolean; clipboardText?: string }

export async function runSelectedAction(record: CandidateRecord, action: SelectedAction, options: ActionOptions = {}): Promise<boolean> {
  switch (action) {
    case "print-session-id": console.log(record.sessionId); return true;
    case "print-session-path": console.log(record.sessionPath); return true;
    case "print-snippet": console.log(record.text); return true;
    case "json": console.log(JSON.stringify(record)); return true;
    case "copy": return copyText(options.clipboardText ?? record.text);
    case "resume": return outputOrExec(buildResumeCommand(record), options.exec);
    case "fork": return outputOrExec(buildForkCommand(record), options.exec);
    case "menu": console.log(record.text); return true;
  }
}

export function buildResumeCommand(record: CandidateRecord): string {
  return `pi --resume ${shellQuote(record.sessionId)}`;
}

export function buildForkCommand(record: CandidateRecord): string {
  return `pi --fork ${shellQuote(record.sessionId)}`;
}

export async function copyText(text: string): Promise<boolean> {
  for (const cmd of ["wl-copy", "xclip", "xsel", "pbcopy"]) {
    const args = cmd === "xclip" ? ["-selection", "clipboard"] : cmd === "xsel" ? ["--clipboard", "--input"] : [];
    if (await pipe(cmd, args, text)) return true;
  }
  console.log(text);
  return false;
}

async function outputOrExec(command: string, exec?: boolean): Promise<boolean> {
  if (!exec) { console.log(command); return true; }
  const [cmd, ...args] = command.split(" ");
  if (!cmd) return false;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function pipe(command: string, args: string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(input);
  });
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
