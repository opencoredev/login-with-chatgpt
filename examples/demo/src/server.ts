import { createChatGPTHandler, type KeyValueStore, type StoredSession } from "@loginwithchatgpt/server";
import index from "./index.html";

interface FileStoreEntry<T> {
  value: T;
  expiresAt?: number;
}

class FileSessionStore<T> implements KeyValueStore<T> {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<T | undefined> {
    const entries = await this.read();
    const entry = entries[key];
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      delete entries[key];
      await this.write(entries);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, options: { ttlMs?: number } = {}): Promise<void> {
    const entries = await this.read();
    entries[key] = {
      value,
      expiresAt: options.ttlMs !== undefined ? Date.now() + options.ttlMs : undefined,
    };
    await this.write(entries);
  }

  async delete(key: string): Promise<void> {
    const entries = await this.read();
    delete entries[key];
    await this.write(entries);
  }

  private async read(): Promise<Record<string, FileStoreEntry<T>>> {
    try {
      return (await Bun.file(this.path).json()) as Record<string, FileStoreEntry<T>>;
    } catch {
      return {};
    }
  }

  private async write(entries: Record<string, FileStoreEntry<T>>): Promise<void> {
    await Bun.write(this.path, `${JSON.stringify(entries, null, 2)}\n`);
  }
}

const sessionFile = new URL("../.lwc-demo-session.json", import.meta.url).pathname;
const sessionStore = new FileSessionStore<StoredSession>(sessionFile);

/**
 * Demo backend. Mounts the Login with ChatGPT handler at `/api/chatgpt/*` and
 * serves the single-page frontend. In production, set `LWC_SECRET` to a stable
 * random string and swap `sessionStore` for a shared store (Redis/Upstash/DB).
 */
const auth = createChatGPTHandler({
  basePath: "/api/chatgpt",
  secret: process.env.LWC_SECRET ?? "login-with-chatgpt-local-demo-secret",
  sessionStore,
  defaultModel: "gpt-5.5",
  responsesProxy: {
    allowedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
    maxRequestBytes: 40 * 1024 * 1024,
  },
  // instructions: "You are a helpful assistant.",
});

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    "/api/chatgpt/*": (req) => auth.handler(req),
  },
  development: { hmr: true, console: true },
});

console.log(`\n  Login with ChatGPT demo → ${server.url}\n`);
