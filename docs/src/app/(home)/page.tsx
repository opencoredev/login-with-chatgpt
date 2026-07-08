import Image from "next/image";
import Link from "next/link";
import { gitConfig } from "@/lib/shared";

const installCode = `bun add @loginwithchatgpt/server \\
  @loginwithchatgpt/react @loginwithchatgpt/ai`;

const serverCode = `const auth = createChatGPTHandler({
  secret: process.env.LWC_SECRET,
});

Bun.serve({
  routes: {
    "/api/chatgpt/*": (req) => auth.handler(req),
  },
});`;

const flow = [
  {
    step: "01",
    title: "Browser starts login",
    body: "The widget shows a consent step, then requests a device code.",
    route: "POST /api/chatgpt/login",
  },
  {
    step: "02",
    title: "User authorizes on OpenAI",
    body: "They enter a short code on auth.openai.com — no redirect URL, no localhost listener.",
    route: "auth.openai.com/codex/device",
  },
  {
    step: "03",
    title: "Server stores the tokens",
    body: "Polling advances one step per request; tokens are encrypted into your session store.",
    route: "GET /api/chatgpt/status",
  },
  {
    step: "04",
    title: "AI SDK streams through you",
    body: "streamText() hits your proxy, which injects credentials and streams back.",
    route: "POST /api/chatgpt/responses",
  },
];

const ownership = {
  browser: [
    ["HttpOnly session cookie", "an opaque signed id — no tokens, ever"],
    ["The user code", "shown once during device authorization"],
    ["Public profile", "email, name, and plan from the id token"],
    ["Streamed text", "responses relayed by your proxy route"],
  ],
  server: [
    ["Access & refresh tokens", "AES-GCM encrypted in your session store"],
    ["Token refresh", "automatic, deduplicated, 60s early margin"],
    ["Rate limits & allowlists", "30 req/min per session by default"],
    ["Origin checks", "cross-site requests can't ride the cookie"],
  ],
};

const sections = [
  {
    title: "Get Started",
    links: [
      ["Introduction", "/docs"],
      ["Quickstart", "/docs/quickstart"],
      ["For AI agents", "/docs/ai"],
    ],
  },
  {
    title: "Concepts",
    links: [
      ["How it works", "/docs/concepts/how-it-works"],
      ["Sessions & tokens", "/docs/concepts/sessions"],
      ["Response proxy", "/docs/concepts/response-proxy"],
      ["Security model", "/docs/concepts/security"],
    ],
  },
  {
    title: "Guides",
    links: [
      ["Build a chat page", "/docs/guides/chat-app"],
      ["Custom sign-in UI", "/docs/guides/custom-ui"],
      ["Cross-origin setup", "/docs/guides/cross-origin"],
      ["Production checklist", "/docs/guides/production"],
    ],
  },
  {
    title: "Reference",
    links: [
      ["Server handler", "/docs/reference/server"],
      ["HTTP routes", "/docs/reference/routes"],
      ["AI SDK providers", "/docs/reference/ai"],
      ["Error codes", "/docs/reference/errors"],
    ],
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="w-full border-b border-fd-border">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-6 py-14 md:grid-cols-[minmax(0,1fr)_420px] md:items-center md:py-20 lg:py-24">
          <div className="max-w-2xl">
            <p className="mb-5 font-mono text-sm text-emerald-600 dark:text-emerald-400">
              OAuth device login for ChatGPT accounts
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Let users bring their own ChatGPT to your app.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-8 text-fd-muted-foreground">
              Server-owned login, encrypted sessions, and Vercel AI SDK
              streaming on the user's plan — no API key from you, no tokens in
              the browser.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs/quickstart"
                className="inline-flex min-h-11 items-center rounded-md bg-fd-foreground px-5 text-sm font-medium text-fd-background transition-colors hover:bg-fd-foreground/90"
              >
                Get started
              </Link>
              <Link
                href="/docs"
                className="inline-flex min-h-11 items-center rounded-md border border-fd-border px-5 text-sm font-medium transition-colors hover:bg-fd-muted"
              >
                Read the docs
              </Link>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
            <div className="flex items-center justify-between border-b border-fd-border px-4 py-2.5">
              <span className="font-mono text-xs text-fd-muted-foreground">
                terminal
              </span>
            </div>
            <pre className="overflow-x-auto p-4 text-[13px] leading-6">
              <code>{installCode}</code>
            </pre>
            <div className="flex items-center justify-between border-y border-fd-border px-4 py-2.5">
              <span className="font-mono text-xs text-fd-muted-foreground">
                server.ts
              </span>
              <span className="font-mono text-xs text-fd-muted-foreground">
                the whole backend
              </span>
            </div>
            <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-fd-muted-foreground">
              <code>{serverCode}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-semibold tracking-tight">
          One handler owns the whole flow
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
          The device-code flow needs no redirect URL, so it works the same in
          serverless, containers, and local dev.
        </p>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-lg border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-4">
          {flow.map(({ step, title, body, route }) => (
            <li key={step} className="flex flex-col bg-fd-background p-5">
              <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                {step}
              </span>
              <h3 className="mt-3 font-medium">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-fd-muted-foreground">
                {body}
              </p>
              <code className="mt-4 block truncate rounded bg-fd-muted px-2 py-1 font-mono text-xs text-fd-muted-foreground">
                {route}
              </code>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-fd-border bg-fd-card/50">
        <div className="mx-auto w-full max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">
            The browser never holds a token
          </h2>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            {(
              [
                ["What the browser sees", ownership.browser],
                ["What your server keeps", ownership.server],
              ] as const
            ).map(([title, rows]) => (
              <div key={title}>
                <h3 className="border-b border-fd-border pb-3 font-mono text-sm text-fd-muted-foreground">
                  {title}
                </h3>
                <dl className="divide-y divide-fd-border">
                  {rows.map(([term, detail]) => (
                    <div
                      key={term}
                      className="grid grid-cols-[minmax(0,11rem)_1fr] gap-4 py-3"
                    >
                      <dt className="text-sm font-medium">{term}</dt>
                      <dd className="text-sm leading-6 text-fd-muted-foreground">
                        {detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
            Signed-in apps can spend the user's plan, so consent is mandatory
            and guardrails are on by default.{" "}
            <Link
              href="/docs/concepts/security"
              className="font-medium text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors hover:decoration-current"
            >
              Read the security model
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-14 md:grid-cols-2">
        <figure className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
          <Image
            src="/screenshots/sign-in.png"
            alt="Login with ChatGPT sign-in screen with device code"
            width={1280}
            height={577}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="w-full"
          />
          <figcaption className="border-t border-fd-border px-4 py-2.5 font-mono text-xs text-fd-muted-foreground">
            The default widget: consent, device code, connected state
          </figcaption>
        </figure>
        <figure className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
          <Image
            src="/screenshots/playground.png"
            alt="Streaming playground after sign-in"
            width={1280}
            height={577}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="w-full"
          />
          <figcaption className="border-t border-fd-border px-4 py-2.5 font-mono text-xs text-fd-muted-foreground">
            Streaming through the proxy on the signed-in account
          </figcaption>
        </figure>
      </section>

      <section className="border-t border-fd-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Find your page
            </h2>
            <div className="flex gap-4 font-mono text-xs text-fd-muted-foreground">
              <a
                href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
                className="transition-colors hover:text-fd-foreground"
              >
                GitHub
              </a>
              <a
                href="/llms.txt"
                className="transition-colors hover:text-fd-foreground"
              >
                llms.txt for agents
              </a>
            </div>
          </div>
          <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {sections.map(({ title, links }) => (
              <nav key={title} aria-label={title}>
                <h3 className="border-b border-fd-border pb-3 font-mono text-sm text-fd-muted-foreground">
                  {title}
                </h3>
                <ul className="mt-3 space-y-1">
                  {links.map(([label, href]) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="-mx-2 block rounded px-2 py-1.5 text-sm transition-colors hover:bg-fd-muted hover:text-emerald-600 dark:hover:text-emerald-400"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
