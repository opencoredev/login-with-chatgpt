/**
 * Base64url helpers built on Web-standard primitives (`atob`/`btoa`,
 * `TextEncoder`), so they run unchanged in browsers, Bun, Node 18+, and edge
 * runtimes without pulling in `Buffer`.
 */

/** Encodes bytes as an unpadded base64url string. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes a base64url string to bytes. Tolerates missing padding. */
export function base64UrlDecodeToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes a base64url string to a UTF-8 string. */
export function base64UrlDecodeToString(value: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(value));
}
