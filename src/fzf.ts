import { spawn } from "node:child_process";

export interface FzfVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface FzfRunOptions {
  candidates?: string | readonly string[];
  version?: FzfVersion;
  query?: string;
  dynamicRg?: boolean;
  fzfCommand?: string;
}

export function parseFzfVersion(raw: string): FzfVersion | undefined {
  const trimmed = raw.trim();
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(trimmed);
  if (!match) return undefined;

  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    raw: trimmed,
  };
}

export async function detectFzfVersion(): Promise<FzfVersion | undefined> {
  return new Promise((resolve) => {
    const child = spawn("fzf", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });

    child.on("error", () => {
      resolve(undefined);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      resolve(parseFzfVersion(output));
    });
  });
}

function isAtLeast(version: FzfVersion | undefined, major: number, minor: number, patch = 0): boolean {
  if (version === undefined) return false;
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}

export function supportsAcceptNth(version: FzfVersion | undefined): boolean {
  return isAtLeast(version, 0, 71);
}

export function supportsIdNth(version: FzfVersion | undefined): boolean {
  return isAtLeast(version, 0, 71);
}

export function buildFzfArgs(options: FzfRunOptions): string[] {
  const piFzfCommand = shellQuote(options.fzfCommand ?? process.env.PI_FZF_COMMAND ?? "pi-fzf");
  const args = [
    "--ansi",
    "--delimiter=\t",
    "--with-nth=2",
    "--exact",
    "--ignore-case",
    "--no-sort",
    `--preview=if [ -n {1} ]; then ${piFzfCommand} preview --key {1} --query {q}; fi`,
  ];

  if (supportsAcceptNth(options.version)) {
    args.push("--accept-nth=1");
  }

  if (supportsIdNth(options.version)) {
    args.push("--id-nth=1", "--track");
  }

  if (options.query !== undefined) {
    args.push(`--query=${options.query}`);
  }

  if (options.dynamicRg === true) {
    const reloadCandidates = `${piFzfCommand} candidates --query {q} || true`;
    args.push(
      "--disabled",
      "--prompt=pi> ",
      `--bind=change:reload:${reloadCandidates}`,
      "--bind=ctrl-f:unbind(change)+change-prompt(fzf> )+enable-search",
    );
  }

  return args;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function runFzf(options: FzfRunOptions): Promise<string | undefined> {
  const args = buildFzfArgs(options);

  return new Promise((resolve, reject) => {
    const child = spawn("fzf", args, {
      stdio: ["pipe", "pipe", "inherit"],
    });

    let output = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(output.replace(/\n$/, ""));
        return;
      }
      if (code === 1 || code === 130) {
        resolve(undefined);
        return;
      }
      reject(new Error(`fzf exited with code ${code ?? "unknown"}`));
    });

    const candidateInput = Array.isArray(options.candidates)
      ? options.candidates.join("\n") + (options.candidates.length > 0 ? "\n" : "")
      : (options.candidates ?? "");

    child.stdin.end(candidateInput);
  });
}
