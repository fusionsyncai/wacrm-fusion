import { describe, expect, it } from "vitest";

import { normalizeAuthUrl } from "@/lib/env/ensure-auth-url";

describe("normalizeAuthUrl", () => {
  it("adds https when protocol is missing", () => {
    expect(normalizeAuthUrl("myapp.vercel.app")).toBe(
      "https://myapp.vercel.app",
    );
  });

  it("strips trailing slashes and quotes", () => {
    expect(normalizeAuthUrl('"https://myapp.vercel.app/"')).toBe(
      "https://myapp.vercel.app",
    );
  });

  it("returns undefined for garbage values", () => {
    expect(normalizeAuthUrl("not a url!!!")).toBeUndefined();
  });
});
