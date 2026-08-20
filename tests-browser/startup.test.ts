import { describe, expect, it, vi } from "vitest";
import { resolveStartup } from "../browser-src/startup";

describe("portable custody startup", () => {
  it("allocates a bounded fresh namespace and returns a stable reopen URL", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000");
    expect(resolveStartup(new URL("https://piton.test/?mode=import"))).toEqual({
      mode: "import-fresh",
      namespace: "piton-import-123e4567-e89b-42d3-a456-426614174000",
      persistentUrl: "?mode=reopen&ns=123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("rejects unbounded or malformed reopen namespace text", () => {
    expect(() => resolveStartup(new URL("https://piton.test/?mode=reopen&ns=../../piton"))).toThrow(
      "invalid import namespace",
    );
    expect(() => resolveStartup(new URL("https://piton.test/?mode=reopen&ns=123e4567-e89b-12d3-a456-426614174000"))).toThrow(
      "invalid import namespace",
    );
  });
});
