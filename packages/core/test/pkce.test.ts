import { describe, expect, test } from "bun:test";
import { base64UrlEncode, generatePkce, randomToken } from "../src/index.ts";

describe("pkce", () => {
  test("generates a valid S256 challenge for the verifier", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier.length).toBeGreaterThan(40);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64UrlEncode(new Uint8Array(digest)));
    expect(challenge).not.toContain("=");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
  });

  test("randomToken produces unique url-safe values", () => {
    const values = new Set(Array.from({ length: 100 }, () => randomToken(16)));
    expect(values.size).toBe(100);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
