# @loginwithchatgpt/react

React UI primitives for [Login with ChatGPT](../../README.md).

This package includes:

- `LoginWithChatGPT`, a styled drop-in widget.
- `useLoginWithChatGPT`, the hook behind the widget.
- `ChatGPTMark`, the compact mark used by the default UI.

`OpenAIMark` is still exported as a deprecated alias for compatibility.

## Button

```tsx
"use client";

import { LoginWithChatGPT } from "@loginwithchatgpt/react";

export function SignIn() {
  return <LoginWithChatGPT basePath="/api/chatgpt" consent={{ appName: "Acme" }} />;
}
```

The drop-in widget opens a consent popup by default. If the user continues, that
same popup navigates to OpenAI's verification page. Pass `consent={false}` only
if your app renders equivalent usage-risk consent before calling `login()`.

## Hook

```tsx
"use client";

import { useLoginWithChatGPT } from "@loginwithchatgpt/react";

export function CustomButton() {
  const auth = useLoginWithChatGPT({ basePath: "/api/chatgpt" });

  if (auth.status === "authenticated") {
    return <button onClick={() => void auth.logout()}>Disconnect ChatGPT</button>;
  }

  if (auth.status === "pending") {
    return <button onClick={() => void auth.copyCode()}>{auth.userCode}</button>;
  }

  return (
    <button onClick={() => void auth.login()}>
      I trust this app, continue
    </button>
  );
}
```

The hook opens the verification window, copies the code when allowed, polls
`/status`, hydrates `/session` on mount, and exposes retry/logout actions.

Peer dependency: `react@^18 || ^19`.
