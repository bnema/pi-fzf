import { describe, expect, it } from "vitest";

import { CACHE_VERSION, EXTRACTOR_VERSION } from "../src/types.js";

describe("package scaffold", () => {
  it("exports cache and extractor versions", () => {
    expect(CACHE_VERSION).toBe(1);
    expect(EXTRACTOR_VERSION).toBe(1);
  });
});
