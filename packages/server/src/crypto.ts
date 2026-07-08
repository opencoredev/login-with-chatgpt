import { base64UrlDecodeToBytes, base64UrlEncode } from "@loginwithchatgpt/core";

/**
 * Web Crypto helpers for signing session cookies (HMAC-SHA256) and encrypting
 * tokens at rest (AES-GCM). Portable across Bun, Node 18+, and edge runtimes.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs `value` and returns `value.signature` (base64url HMAC). */
export async function sign(value: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}.${base64UrlEncode(new Uint8Array(mac))}`;
}

/** Verifies a `value.signature` string and returns the value, or `undefined`. */
export async function unsign(signed: string, secret: string): Promise<string | undefined> {
  const index = signed.lastIndexOf(".");
  if (index <= 0) return undefined;
  const value = signed.slice(0, index);
  const provided = signed.slice(index + 1);
  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  const providedBytes = safeDecode(provided);
  if (!providedBytes) return undefined;
  return timingSafeEqual(new Uint8Array(expected), providedBytes) ? value : undefined;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a JSON-serializable value to an `iv.ciphertext` base64url string. */
export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

/** Decrypts a value produced by {@link encryptJson}. Returns `undefined` on tamper/parse failure. */
export async function decryptJson<T>(payload: string, secret: string): Promise<T | undefined> {
  const [ivPart, dataPart] = payload.split(".");
  if (!ivPart || !dataPart) return undefined;
  const iv = safeDecode(ivPart);
  const data = safeDecode(dataPart);
  if (!iv || !data) return undefined;
  try {
    const key = await aesKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return undefined;
  }
}

function safeDecode(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    // Copy into a fresh ArrayBuffer-backed view so it satisfies BufferSource.
    return Uint8Array.from(base64UrlDecodeToBytes(value));
  } catch {
    return undefined;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
