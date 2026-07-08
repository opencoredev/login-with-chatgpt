import { describe, expect, test } from "bun:test";
import { readCookie, serializeCookie } from "../src/cookies.ts";

describe("cookies", () => {
  test("reads a named cookie value", () => {
    const request = new Request("https://x.dev", { headers: { cookie: "a=1; lwc_session=abc%3D; b=2" } });
    expect(readCookie(request, "lwc_session")).toBe("abc=");
    expect(readCookie(request, "a")).toBe("1");
    expect(readCookie(request, "missing")).toBeUndefined();
  });

  test("returns undefined without a cookie header", () => {
    expect(readCookie(new Request("https://x.dev"), "lwc_session")).toBeUndefined();
  });

  test("serializes attributes with sensible defaults", () => {
    const cookie = serializeCookie("lwc_session", "v=", { maxAge: 60, secure: true });
    expect(cookie).toContain("lwc_session=v%3D");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=60");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("omits HttpOnly when explicitly disabled", () => {
    expect(serializeCookie("k", "v", { httpOnly: false })).not.toContain("HttpOnly");
  });
});
