import { base64UrlEncode } from "../src/index.ts";

const encoder = new TextEncoder();

/** Builds an unsigned JWT (`alg: none`) with the given claims. */
export function makeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "none", typ: "JWT" })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${header}.${body}.sig`;
}

/** Builds an id token carrying the ChatGPT account/plan claims. */
export function makeIdToken(options: {
  accountId?: string;
  email?: string;
  name?: string;
  plan?: string;
  expiresInSeconds?: number;
} = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({
    email: options.email,
    name: options.name,
    exp: now + (options.expiresInSeconds ?? 3600),
    "https://api.openai.com/auth": {
      chatgpt_account_id: options.accountId ?? "acct_123",
      chatgpt_plan_type: options.plan,
    },
  });
}

/** Builds an access token with a specific expiry (epoch seconds offset). */
export function makeAccessToken(expiresInSeconds: number): string {
  return makeJwt({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds });
}

/** Convenience JSON `Response`. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A recording mock fetch driven by a handler function. */
export function createMockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}
