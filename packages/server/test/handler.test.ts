import { describe, expect, test } from "bun:test";
import { createChatGPTHandler } from "../src/index.ts";
import { createMockFetch, createOpenAIMock, jsonResponse, makeAccessToken, makeIdToken, makeJwt } from "./helpers.ts";

const BASE = "https://app.dev/api/chatgpt";

/** Extracts the session cookie name=value pair from a response for reuse. */
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

describe("createChatGPTHandler", () => {
  test("runs the full login → status → session → logout lifecycle", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    // 1. Start login.
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { status: string; userCode: string; verificationUrl: string };
    expect(loginBody.status).toBe("pending");
    expect(loginBody.userCode).toBe("ABCD-1234");
    expect(loginBody.verificationUrl).toBe("https://auth.openai.com/codex/device");
    const cookie = cookieFrom(login);
    expect(cookie).toContain("lwc_session=");

    // 2. Poll status until authenticated.
    clock += 2000;
    const status = await handler.handler(
      new Request(`${BASE}/status`, { headers: { cookie } }),
    );
    const statusBody = (await status.json()) as { status: string; user?: { email?: string } };
    expect(statusBody.status).toBe("authenticated");
    expect(statusBody.user?.email).toBe("savio@result.dev");

    // 3. Session reflects the authenticated user without polling.
    const session = await handler.handler(new Request(`${BASE}/session`, { headers: { cookie } }));
    expect(((await session.json()) as { status: string }).status).toBe("authenticated");

    // 4. Logout clears the session.
    const logout = await handler.handler(new Request(`${BASE}/logout`, { method: "POST", headers: { cookie } }));
    expect(((await logout.json()) as { status: string }).status).toBe("unauthenticated");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("proxies /responses for an authenticated session and streams", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input: "Tell me a joke?" }),
      }),
    );
    expect(responses.status).toBe(200);
    expect(responses.headers.get("content-type")).toContain("text/event-stream");
    expect(await responses.text()).toContain("response.output_text.delta");
  });

  test("enforces responses proxy model allowlist", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { allowedModels: ["gpt-allowed"] },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const disallowed = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-other", input: "hi" }),
      }),
    );
    expect(disallowed.status).toBe(403);
    expect(await disallowed.json()).toEqual({ error: "model_not_allowed", model: "gpt-other" });

    const allowed = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-allowed", input: "hi" }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  test("enforces responses proxy request body limit", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { maxRequestBytes: 20 },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tooLarge = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input: "this body is too large" }),
      }),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "responses_request_too_large", maxRequestBytes: 20 });
  });

  test("passes validated Codex service tier through the responses proxy", async () => {
    let responseBody: Record<string, unknown> | undefined;
    const fetch = createMockFetch((url, init) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: makeAccessToken(3600),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1", email: "savio@result.dev", plan: "pro" }),
        });
      }
      if (new URL(url).pathname.endsWith("/responses")) {
        responseBody = JSON.parse(String(init?.body));
        return new Response('data: {"type":"response.output_text.delta","delta":"hi"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    let clock = 1000;
    const handler = createChatGPTHandler({ fetch, secret: "test-secret", now: () => clock });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "fast",
          "x-login-with-chatgpt-reasoning-effort": "high",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );

    expect(responses.status).toBe(200);
    expect(responseBody?.service_tier).toBe("fast");
    expect(responseBody?.reasoning).toMatchObject({ effort: "high" });

    const invalid = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "warp",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_service_tier", serviceTier: "warp" });

    const invalidReasoning = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-reasoning-effort": "galaxy",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );
    expect(invalidReasoning.status).toBe(400);
    expect(await invalidReasoning.json()).toEqual({ error: "invalid_reasoning_effort", reasoningEffort: "galaxy" });
  });

  test("falls back when upstream rejects Codex fast service tier", async () => {
    const responseBodies: Array<Record<string, unknown>> = [];
    const fetch = createMockFetch((url, init) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: makeAccessToken(3600),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1", email: "savio@result.dev", plan: "pro" }),
        });
      }
      if (new URL(url).pathname.endsWith("/responses")) {
        const body = JSON.parse(String(init?.body));
        responseBodies.push(body);
        if (body.service_tier === "fast") {
          return jsonResponse({ detail: "Unsupported service_tier: fast" }, 400);
        }
        return new Response('data: {"type":"response.output_text.delta","delta":"hi"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    let clock = 1000;
    const handler = createChatGPTHandler({ fetch, secret: "test-secret", now: () => clock });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "fast",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );

    expect(responses.status).toBe(200);
    expect(responses.headers.get("x-login-with-chatgpt-service-tier-fallback")).toBe("auto");
    expect(responseBodies).toHaveLength(2);
    expect(responseBodies[0]?.service_tier).toBe("fast");
    expect(responseBodies[1]?.service_tier).toBeUndefined();
  });

  test("rejects invalid /responses bodies before proxying", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const invalid = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "nope",
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_responses_request",
      message: "Expected a JSON object body.",
    });
  });

  test("lists models for an authenticated session", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1, models: ["gpt-a", "gpt-b"] }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const models = await handler.handler(new Request(`${BASE}/models`, { headers: { cookie } }));
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ models: ["gpt-a", "gpt-b"] });

    expect(await handler.getModels(new Request(`${BASE}/models`, { headers: { cookie } }))).toEqual(["gpt-a", "gpt-b"]);
  });

  test("rejects /responses without an authenticated session", async () => {
    const handler = createChatGPTHandler({ fetch: createOpenAIMock(), secret: "s" });
    const res = await handler.handler(
      new Request(`${BASE}/responses`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(401);
  });

  test("redacts the refresh token from getTokens unless explicitly requested", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tokens = await handler.getTokens(new Request(`${BASE}/session`, { headers: { cookie } }));
    expect(tokens?.accessToken).toBeString();
    expect(tokens?.accountId).toBe("acct_1");
    expect(tokens?.refreshToken).toBeUndefined();

    const exported = await handler.getTokens(
      new Request(`${BASE}/session`, { headers: { cookie } }),
      { includeRefreshToken: true },
    );
    expect(exported?.refreshToken).toBe("rt");
  });

  test("rate limits /responses per session and recovers after the window", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { rateLimit: { limit: 2, windowMs: 60_000 } },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const send = () =>
      handler.handler(
        new Request(`${BASE}/responses`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ input: "hi" }),
        }),
      );

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeString();
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");

    clock += 61_000;
    expect((await send()).status).toBe(200);
  });

  test("rejects cross-origin POSTs unless the origin is allowlisted", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      allowedOrigins: ["https://trusted.example"],
    });

    // Same-origin browser POST passes.
    const sameOrigin = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://app.dev" } }),
    );
    expect(sameOrigin.status).toBe(200);

    // Allowlisted cross-origin POST passes.
    const allowlisted = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://trusted.example" } }),
    );
    expect(allowlisted.status).toBe(200);

    // Anything else is rejected before reaching the route.
    const crossSite = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) as { error: string }).error).toBe("origin_not_allowed");

    const opaque = await handler.handler(
      new Request(`${BASE}/logout`, { method: "POST", headers: { origin: "null" } }),
    );
    expect(opaque.status).toBe(403);

    // Non-browser requests (no Origin header) are unaffected.
    const server = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    expect(server.status).toBe(200);
  });

  test("deduplicates concurrent token refreshes for one session", async () => {
    let clock = 1000;
    const fetch = createMockFetch((url) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        // exp: 2s epoch — already expired against the mocked clock, so every
        // getFreshTokens call would refresh without single-flight dedup.
        return jsonResponse({
          access_token: makeJwt({ exp: 2 }),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1" }),
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const handler = createChatGPTHandler({ fetch, secret: "test-secret", now: () => clock });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tokenCallsBefore = fetch.calls.filter((c) => c.url.endsWith("/oauth/token")).length;
    const request = () => handler.getTokens(new Request(`${BASE}/session`, { headers: { cookie } }));
    await Promise.all([request(), request(), request(), request()]);
    const tokenCallsAfter = fetch.calls.filter((c) => c.url.endsWith("/oauth/token")).length;
    expect(tokenCallsAfter - tokenCallsBefore).toBe(1);
  });

  test("returns 404 for unknown routes and 405 for wrong methods", async () => {
    const handler = createChatGPTHandler({ fetch: createOpenAIMock(), secret: "s" });
    expect((await handler.handler(new Request(`${BASE}/nope`))).status).toBe(404);
    expect((await handler.handler(new Request(`${BASE}/login`))).status).toBe(405); // GET, needs POST
  });
});
