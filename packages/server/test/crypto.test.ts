import { describe, expect, test } from "bun:test";
import { decryptJson, encryptJson, sign, unsign } from "../src/crypto.ts";

const SECRET = "test-secret-please-change";

describe("cookie signing", () => {
  test("round-trips a signed value", async () => {
    const signed = await sign("session-id", SECRET);
    expect(signed).toContain("session-id.");
    expect(await unsign(signed, SECRET)).toBe("session-id");
  });

  test("rejects a tampered value", async () => {
    const signed = await sign("session-id", SECRET);
    const tampered = signed.replace("session-id", "evil-id");
    expect(await unsign(tampered, SECRET)).toBeUndefined();
  });

  test("rejects a wrong secret", async () => {
    const signed = await sign("session-id", SECRET);
    expect(await unsign(signed, "other-secret")).toBeUndefined();
  });
});

describe("token encryption", () => {
  test("round-trips encrypted JSON", async () => {
    const payload = { accessToken: "at", refreshToken: "rt" };
    const cipher = await encryptJson(payload, SECRET);
    expect(cipher).not.toBe(JSON.stringify(payload));
    expect(await decryptJson<typeof payload>(cipher, SECRET)).toEqual(payload);
  });

  test("fails to decrypt with the wrong secret", async () => {
    const cipher = await encryptJson({ a: 1 }, SECRET);
    expect(await decryptJson(cipher, "nope")).toBeUndefined();
  });

  test("produces a unique ciphertext per call (random IV)", async () => {
    const a = await encryptJson({ a: 1 }, SECRET);
    const b = await encryptJson({ a: 1 }, SECRET);
    expect(a).not.toBe(b);
  });
});
