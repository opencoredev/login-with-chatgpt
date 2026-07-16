import {
  createMockFetch,
  jsonResponse,
  makeAccessToken,
  makeIdToken,
  makeJwt,
} from "../../core/test/helpers.ts";

export { createMockFetch, jsonResponse, makeAccessToken, makeIdToken, makeJwt };

/**
 * A mock of OpenAI's auth + Codex endpoints that walks the full device flow:
 * usercode → N pending polls → authorized → token exchange → responses stream.
 */
export function createOpenAIMock(
  options: { pollsUntilAuthorized?: number; account?: string; models?: string[] } = {},
) {
  const target = options.pollsUntilAuthorized ?? 1;
  let polls = 0;
  return createMockFetch((url) => {
    if (url.endsWith("/deviceauth/usercode")) {
      return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
    }
    if (url.endsWith("/deviceauth/token")) {
      polls += 1;
      if (polls < target) return new Response("", { status: 403 });
      return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
    }
    if (url.endsWith("/oauth/token")) {
      return jsonResponse({
        access_token: makeAccessToken(3600),
        refresh_token: "rt",
        id_token: makeIdToken({ accountId: options.account ?? "acct_1", email: "savio@result.dev", plan: "pro" }),
      });
    }
    if (new URL(url).pathname.endsWith("/models")) {
      return jsonResponse({ models: (options.models ?? ["gpt-a", "gpt-b"]).map((slug) => ({ slug })) });
    }
    if (new URL(url).pathname.endsWith("/responses")) {
      return new Response('data: {"type":"response.output_text.delta","delta":"hi"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (new URL(url).pathname === "/realtime/vp" || new URL(url).pathname === "/realtime/vps") {
      return new Response("v=0\r\no=- mock-answer", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
}
