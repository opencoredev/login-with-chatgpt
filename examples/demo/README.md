# Login with ChatGPT demo

Local Bun demo for the SDK.

```bash
bun install
bun run demo
```

Default URL: http://localhost:3000.

The demo:

- mounts `createChatGPTHandler()` at `/api/chatgpt/*`
- renders a centered sign-in gate before authentication
- opens the OpenAI device-code verification flow
- lists available models with `chatgpt.listModels()`
- streams a prompt through the browser-safe AI SDK proxy

Optional local secret:

```bash
LWC_SECRET="$(openssl rand -hex 32)" bun run demo
```

Headless CLI example:

```bash
bun --cwd examples/demo run src/login-cli.ts "Explain promises in one line"
```
