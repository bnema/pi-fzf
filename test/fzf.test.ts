import { describe, expect, it } from "vitest";

import {
  buildFzfArgs,
  parseFzfVersion,
  supportsAcceptNth,
  supportsIdNth,
  type FzfVersion,
} from "../src/fzf.js";

const version = (raw: string): FzfVersion => {
  const parsed = parseFzfVersion(raw);
  if (parsed === undefined) throw new Error(`failed to parse ${raw}`);
  return parsed;
};

describe("parseFzfVersion", () => {
  it("parses simple semantic versions", () => {
    expect(parseFzfVersion("0.72.0")).toEqual({ major: 0, minor: 72, patch: 0, raw: "0.72.0" });
    expect(parseFzfVersion("0.73.1")).toEqual({ major: 0, minor: 73, patch: 1, raw: "0.73.1" });
  });

  it("parses versions from fzf --version output", () => {
    expect(parseFzfVersion("0.72.0 (devel)\n")?.minor).toBe(72);
  });

  it("returns undefined when no version is present", () => {
    expect(parseFzfVersion("fzf dev")).toBeUndefined();
  });
});

describe("fzf feature support", () => {
  it("targets full support for fzf 0.71 and newer", () => {
    expect(supportsAcceptNth(version("0.70.9"))).toBe(false);
    expect(supportsAcceptNth(version("0.71.0"))).toBe(true);
    expect(supportsIdNth(version("0.71.0"))).toBe(true);
    expect(supportsIdNth(version("0.73.1"))).toBe(true);
  });

  it("treats unknown versions as unsupported for optional flags", () => {
    expect(supportsAcceptNth(undefined)).toBe(false);
    expect(supportsIdNth(undefined)).toBe(false);
  });
});

describe("buildFzfArgs", () => {
  it("builds field-aware args with preview and supported identity flags", () => {
    const args = buildFzfArgs({ version: version("0.72.0") });

    expect(args).toContain("--ansi");
    expect(args).toContain("--delimiter=\t");
    expect(args).toContain("--with-nth=2");
    expect(args).not.toContain("--nth=2,3");
    expect(args).toContain("--exact");
    expect(args).toContain("--ignore-case");
    expect(args).toContain("--no-sort");
    expect(args).toContain("--accept-nth=1");
    expect(args).toContain("--id-nth=1");
    expect(args).toContain("--track");
    expect(args).toContain("--preview=pi-fzf preview --key {1} --query {q}");
  });

  it("omits accept-nth and id tracking flags when unsupported", () => {
    const args = buildFzfArgs({ version: version("0.70.0") });

    expect(args).not.toContain("--accept-nth=1");
    expect(args).not.toContain("--id-nth=1");
    expect(args).not.toContain("--track");
  });

  it("builds dynamic rg mode bindings", () => {
    const args = buildFzfArgs({ version: version("0.73.1"), dynamicRg: true });

    expect(args).toContain("--disabled");
    expect(args).toContain("--prompt=pi> ");
    expect(args).not.toContain("--bind=start:reload:pi-fzf candidates --query {q} || true");
    expect(args).toContain("--bind=change:reload:pi-fzf candidates --query {q} || true");
    expect(args).toContain("--bind=ctrl-f:unbind(change)+change-prompt(fzf> )+enable-search");
  });

  it("uses a configurable pi-fzf command for previews and reloads", () => {
    const args = buildFzfArgs({ version: version("0.73.1"), dynamicRg: true, fzfCommand: "/home/me/.local/bin/pi-fzf-search" });

    expect(args).toContain("--preview=/home/me/.local/bin/pi-fzf-search preview --key {1} --query {q}");
    expect(args).toContain("--bind=change:reload:/home/me/.local/bin/pi-fzf-search candidates --query {q} || true");
  });
});
