<h1 align="center">&lt;LoginWithChatGPT /&gt;</h1>

<p align="center">A simple SDK that lets your users log in with their ChatGPT account.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opencoredev/loginwithchatgpt-core"><img alt="npm version" src="https://shieldcn.dev/npm/@opencoredev/loginwithchatgpt-core.svg?variant=secondary&mode=dark" /></a>
  <a href="https://github.com/opencoredev/login-with-chatgpt/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/opencoredev/login-with-chatgpt/stars.svg?variant=branded&mode=dark" /></a>
  <a href="https://x.com/leodev"><img alt="Follow @leodev on X" src="https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark" /></a>
</p>

- Users bring their own ChatGPT subscription
- Tokens never touch the browser: HttpOnly cookie only
- Works with the Vercel AI SDK: `streamText()` straight from the client
- Generates and edits images with size, quality, format, masks, and streaming previews
- Experimental GPT Live audio over WebRTC with interruption controls; direct
  `/wm` remains voice-only, while the server package exposes desktop-style
  app-server handoffs for allowlisted tools and explicit confirmations
- Open source, MIT licensed

The handler keeps tokens behind the proxy path by default. The browser gets a session cookie, asks your backend which models the account has, and streams from there.

## Install

```bash
bun add @opencoredev/loginwithchatgpt-core @opencoredev/loginwithchatgpt-server @opencoredev/loginwithchatgpt-react @opencoredev/loginwithchatgpt-ai
```

npm and pnpm work too. Everything ships as ESM with types for Node 18+.

## Packages

| Package | Does |
| --- | --- |
| `@opencoredev/loginwithchatgpt-core` | OAuth, token refresh, model discovery, and experimental private voice transport |
| `@opencoredev/loginwithchatgpt-server` | Backend handler: login, session, models, responses, and private voice signaling |
| `@opencoredev/loginwithchatgpt-react` | The `<LoginWithChatGPT />` button and hook |
| `@opencoredev/loginwithchatgpt-ai` | Vercel AI SDK providers |

## Docs

Start with the [quickstart](./docs/content/docs/quickstart.mdx). The [security model](./docs/content/docs/concepts/security.mdx) explains how tokens stay on your server, and the [production checklist](./docs/content/docs/guides/production.mdx) is there for when you deploy.

For the experimental subscription-backed speech-to-speech transport, its
limitations, interruption controls, and captions, see
[experimental ChatGPT voice transport](./docs/content/docs/guides/realtime-voice.mdx).

## Agent skill

Using Claude Code, Cursor, or Codex? Install the [agent skill](./skills/login-with-chatgpt/SKILL.md) so your agent wires the SDK correctly: no invented API keys, and no assuming one model slug works for every account.

```bash
npx skills add opencoredev/login-with-chatgpt
```

Then just ask your agent to "add Login with ChatGPT" and it will mount the handler, render the button, and stream through the proxy the right way. Also on [skills.sh](https://skills.sh/opencoredev/login-with-chatgpt).

## Star history

<p align="center">
  <a href="https://github.com/opencoredev/login-with-chatgpt/stargazers"><img alt="Star history" src="https://shieldcn.dev/chart/github/stars/opencoredev/login-with-chatgpt.svg?mode=dark" /></a>
</p>

<p align="center"><sub><a href="./LICENSE">MIT License</a> · Built by <a href="https://x.com/leodev">@leodev</a></sub></p>
