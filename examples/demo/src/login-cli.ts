/**
 * Headless "Login with ChatGPT" example — no browser redirect, so it works over
 * SSH, in containers, and in the cloud. Signs in via the device-code flow, then
 * streams one completion on the user's own ChatGPT plan through the AI SDK.
 *
 *   bun run src/login-cli.ts "your prompt here"
 */
import { createChatGPT } from "@loginwithchatgpt/ai";
import { requestDeviceCode, resolveConfig, waitForDeviceTokens } from "@loginwithchatgpt/core";
import { streamText } from "ai";

const prompt = process.argv[2] ?? "Tell me a short joke about caching.";
const config = resolveConfig();

const device = await requestDeviceCode(config);
try {
  await Bun.$`printf %s ${device.userCode} | pbcopy`.quiet();
} catch {
  // clipboard is best-effort
}

console.log("\n──────────────────────────────────────────────");
console.log("  Sign in with ChatGPT");
console.log("──────────────────────────────────────────────");
console.log(`  1. Open: ${device.verificationUrl}`);
console.log(`  2. Enter code: ${device.userCode}   (copied to clipboard)`);
console.log("──────────────────────────────────────────────\n");

process.stdout.write("Waiting for authorization…");
const tokens = await waitForDeviceTokens(config, device, {
  onPoll: (n) => process.stdout.write(`\rWaiting for authorization… (poll ${n})   `),
});
console.log(`\n✓ Signed in (account ${tokens.accountId}).\n`);

const chatgpt = createChatGPT({ credentials: tokens });
console.log(`> ${prompt}\n`);
const { textStream } = streamText({ model: chatgpt(), prompt });
for await (const delta of textStream) process.stdout.write(delta);
console.log("\n");
