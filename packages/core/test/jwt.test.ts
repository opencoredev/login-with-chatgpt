import { describe, expect, test } from "bun:test";
import { decodeJwt, deriveAccountId, getTokenExpiry, parseUser } from "../src/index.ts";
import { makeIdToken, makeJwt } from "./helpers.ts";

describe("jwt", () => {
  test("decodes a payload", () => {
    const token = makeJwt({ hello: "world", n: 1 });
    expect(decodeJwt(token)).toEqual({ hello: "world", n: 1 });
  });

  test("returns undefined for malformed tokens", () => {
    expect(decodeJwt("not-a-jwt")).toBeUndefined();
    expect(decodeJwt(undefined)).toBeUndefined();
    expect(decodeJwt("a.b")).toBeUndefined();
  });

  test("derives the ChatGPT account id from the auth claim", () => {
    const token = makeIdToken({ accountId: "acct_xyz" });
    expect(deriveAccountId(token)).toBe("acct_xyz");
  });

  test("returns undefined account id when the claim is absent", () => {
    expect(deriveAccountId(makeJwt({ sub: "u" }))).toBeUndefined();
  });

  test("reads token expiry in milliseconds", () => {
    const token = makeJwt({ exp: 2_000_000_000 });
    expect(getTokenExpiry(token)).toBe(2_000_000_000_000);
  });

  test("parses a public user profile", () => {
    const token = makeIdToken({ accountId: "acct_1", email: "a@b.dev", name: "Ada", plan: "pro" });
    expect(parseUser(token)).toEqual({
      accountId: "acct_1",
      email: "a@b.dev",
      name: "Ada",
      plan: "pro",
    });
  });

  test("returns undefined user when account id is missing", () => {
    expect(parseUser(makeJwt({ email: "x@y.dev" }))).toBeUndefined();
  });
});
