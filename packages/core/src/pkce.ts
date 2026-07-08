import { base64UrlEncode } from "./internal/base64.ts";
import type { PkcePair } from "./types.ts";

const encoder = new TextEncoder();

/** Returns `length` cryptographically-random bytes as a base64url string. */
export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Generates a random OAuth `state` value for CSRF protection. */
export function createState(): string {
  return randomToken(16);
}

/**
 * Generates a PKCE verifier/challenge pair using S256, per RFC 7636. Used by
 * the loopback redirect flow; the device flow receives its pair from OpenAI.
 */
export async function generatePkce(): Promise<PkcePair> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}
