import { ChatGPTProxyError, createChatGPTProxyProvider } from "@loginwithchatgpt/ai";
import {
  ChatGPTMark,
  openLoginWithChatGPTConsentPopup,
  useLoginWithChatGPT,
  type UseLoginWithChatGPTResult,
} from "@loginwithchatgpt/react";
import {
  ArrowUpRight,
  BookOpen,
  CaretDown,
  Check,
  CircleNotch,
  Copy,
  File as FileIcon,
  ImageSquare,
  Lightning,
  Paperclip,
  PaperPlaneRight,
  SignOut,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { streamText } from "ai";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const PREFERRED_MODEL = "gpt-5.5";
const PREFERRED_MODEL_LABEL = "GPT-5.5";
const CURATED_MODELS = [PREFERRED_MODEL, "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"];
const DOCS_URL = "http://localhost:3001";
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const chatgpt = createChatGPTProxyProvider({ basePath: "/api/chatgpt" });
const SERVICE_TIER_HEADER = "x-login-with-chatgpt-service-tier";
const REASONING_EFFORT_HEADER = "x-login-with-chatgpt-reasoning-effort";

type ServiceTier = "auto" | "fast";
type ThinkingLevel = "low" | "medium" | "high";

type AttachmentItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  url?: string;
};

type ChatTurn = {
  id: number;
  prompt: string;
  response: string;
  model: string;
  serviceTier: ServiceTier;
  thinking: ThinkingLevel;
  attachments: AttachmentItem[];
  reasoning: string[];
};

const PROMPT_SUGGESTIONS = [
  "Show me the shortest React integration.",
  "Explain how attachments should flow through this SDK.",
  "Write a GPT-5.5 prompt for refactoring.",
];

function App() {
  const auth = useLoginWithChatGPT({ basePath: "/api/chatgpt" });
  if (auth.status === "loading") return <SessionLoading />;
  return auth.isAuthenticated ? <Playground auth={auth} /> : <AuthGate auth={auth} />;
}

function SessionLoading() {
  return (
    <div className="auth auth-loading" aria-label="Checking session">
      <ChatGPTMark width={28} height={28} />
    </div>
  );
}

/* ─── Sign-in gate ─── */
function AuthGate({ auth }: { auth: UseLoginWithChatGPTResult }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="mark">
          <ChatGPTMark width={34} height={34} />
        </div>
        {auth.isPending ? (
          <Device auth={auth} />
        ) : (
          <>
            <h1 className="auth-title">Log in with ChatGPT</h1>
            <p className="auth-sub">
              Run prompts on your own ChatGPT plan. No API key or per-token billing.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                const popup = openLoginWithChatGPTConsentPopup({
                  appName: "Login with ChatGPT demo",
                  login: auth.login,
                  securityHref: `${DOCS_URL}/docs/security`,
                });
                if (!popup) void auth.login();
              }}
              disabled={auth.isConnecting}
            >
              {auth.isConnecting ? <CircleNotch className="spin" size={18} weight="bold" /> : <ChatGPTMark width={18} height={18} />}
              {auth.isConnecting ? "Connecting…" : "Login with ChatGPT"}
            </button>
            <a className="link" href={DOCS_URL} target="_blank" rel="noreferrer">
              <BookOpen size={15} /> Read the docs <ArrowUpRight size={13} />
            </a>
            {auth.status === "error" && <span className="error">Something went wrong. Try again.</span>}
          </>
        )}
      </div>
    </div>
  );
}

function Device({ auth }: { auth: UseLoginWithChatGPTResult }) {
  return (
    <div className="device">
      <span className="waiting">
        <CircleNotch className="spin" size={16} weight="bold" /> Waiting for authorization…
      </span>
      <div className="code-box">
        <span className="cap">Enter this code in the opened window</span>
        <div className="code-row">
          <span className="code">{auth.userCode}</span>
          {!auth.copied && (
            <button className="icon-btn" onClick={() => void auth.copyCode()} aria-label="Copy code">
              <Copy size={17} />
            </button>
          )}
        </div>
        {auth.copied && (
          <span className="copied">
            <Check size={14} weight="bold" /> Copied to clipboard
          </span>
        )}
      </div>
      <button className="link" onClick={() => auth.reopen()}>
        Reopen sign-in window <ArrowUpRight size={13} />
      </button>
    </div>
  );
}

/* ─── Playground ─── */
function Playground({ auth }: { auth: UseLoginWithChatGPTResult }) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [serviceTier, setServiceTier] = useState<ServiceTier>("auto");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [modelStatus, setModelStatus] = useState<"loading" | "ready">("loading");
  const [modelWarning, setModelWarning] = useState<string | undefined>();
  const [statusNotice, setStatusNotice] = useState<string | undefined>();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draftTurn, setDraftTurn] = useState<ChatTurn | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logout = auth.logout;

  // Load the account's real model list.
  useEffect(() => {
    let active = true;
    setModelStatus("loading");
    chatgpt
      .listModels()
      .then((accountModels) => {
        if (!active) return;
        if (accountModels.length === 0) {
          applyPreferredModelFallback();
          return;
        }
        const verifiedModels = rankModels([...accountModels, ...CURATED_MODELS]);
        setModels(verifiedModels);
        setModel((current) => {
          if (current && verifiedModels.includes(current)) return current;
          return verifiedModels.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : (verifiedModels[0] ?? "");
        });
        setModelWarning(undefined);
        setModelStatus("ready");
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ChatGPTProxyError && e.status === 401) {
          void logout();
          return;
        }
        applyPreferredModelFallback();
      });

    function applyPreferredModelFallback() {
      if (!active) return;
      setModels([PREFERRED_MODEL]);
      setModel(PREFERRED_MODEL);
      setModelWarning("Could not refresh the account model list. Trying GPT-5.5.");
      setModelStatus("ready");
    }

    return () => {
      active = false;
    };
  }, [logout]);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [turns, draftTurn?.response]);

  async function send() {
    const nextPrompt = prompt.trim();
    const requestTier = serviceTier;
    if (running || !model || (!nextPrompt && attachments.length === 0)) return;
    const turnId = Date.now();
    const nextAttachments = attachments;
    const nextTurn = {
      id: turnId,
      prompt: nextPrompt || "Review the attached files.",
      response: "",
      model,
      serviceTier: requestTier,
      thinking,
      attachments: nextAttachments,
      reasoning: buildReasoning(model, requestTier, thinking, nextAttachments),
    };
    setRunning(true);
    setPrompt("");
    setAttachments([]);
    setDraftTurn(nextTurn);
    setError(undefined);
    setCopied(false);
    try {
      const result = streamText({
        model: chatgpt(model),
        messages: buildMessages(nextTurn.prompt, nextAttachments),
        headers: buildRequestHeaders(requestTier, thinking),
        onError: ({ error: e }) => setError(getRequestErrorMessage(e)),
      });
      let streamed = "";
      for await (const delta of result.textStream) {
        streamed += delta;
        setDraftTurn({ ...nextTurn, response: streamed });
      }
      setTurns((prev) => [...prev, { ...nextTurn, response: streamed }]);
      setDraftTurn(undefined);
    } catch (e) {
      setError(getRequestErrorMessage(e));
      setPrompt(nextPrompt);
      setAttachments(nextAttachments);
    } finally {
      setRunning(false);
    }
  }

  async function addAttachments(files: FileList | null) {
    if (!files) return;
    setError(undefined);
    const selected = Array.from(files).slice(0, MAX_ATTACHMENTS);
    const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} is too large for the demo composer. Keep files under ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const next = await Promise.all(
        selected.map(async (file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
          url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        })),
      );
      setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the selected files.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  async function copyOutput() {
    const latest = draftTurn?.response || turns.at(-1)?.response;
    if (!latest || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(latest);
      setCopied(true);
    } catch {}
  }

  const visibleTurns = draftTurn ? [...turns, draftTurn] : turns;
  const latestOutput = draftTurn?.response || turns.at(-1)?.response;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <span className="brand-mark">
              <ChatGPTMark width={16} height={16} />
            </span>
          </span>
          <span className="demo-warning">
            <WarningCircle size={14} weight="bold" />
            Demo only. Bad production pattern; use the SDK with your own safeguards.
          </span>
          <span className="spacer" />
          <a className="top-link" href={DOCS_URL} target="_blank" rel="noreferrer">
            <BookOpen size={15} /> Docs
          </a>
          <button className="ghost-btn" onClick={() => void auth.logout()}>
            <SignOut size={15} /> Sign out
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="response">
          {error ? (
            <div className="error">
              <span>{error}</span>
              {error.includes("Model list") && (
                <button className="error-action" onClick={() => window.location.reload()} type="button">
                  Retry
                </button>
              )}
            </div>
          ) : visibleTurns.length > 0 ? (
            <div className="thread" ref={outRef}>
              {visibleTurns.map((turn) => (
                <article className="turn" key={turn.id}>
                  <div className="bubble user-bubble">
                    <span>{turn.prompt}</span>
                    {turn.attachments.length > 0 && (
                      <div className="message-attachments">
                        {turn.attachments.map((attachment) => (
                          <AttachmentChip attachment={attachment} key={attachment.id} onRemove={() => {}} readonly />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="assistant-row">
                    <span className="assistant-mark">
                      <ChatGPTMark width={14} height={14} />
                    </span>
                    <div className="assistant-content">
                      <span className="assistant-meta">
                        {turn.model} · {turn.serviceTier === "fast" ? "fast" : "auto"} · {turn.thinking} thinking
                      </span>
                      <details className="reasoning">
                        <summary>Request trace</summary>
                        <ol>
                          {turn.reasoning.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </details>
                      <div className="output">
                        {turn.response || "Thinking..."}
                        {running && turn.id === draftTurn?.id && <span className="caret" />}
                      </div>
                      {turn.response && turn.id === turns.at(-1)?.id && (
                        <button className="copy-inline" onClick={() => void copyOutput()} type="button">
                          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                          {copied ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <ChatGPTMark width={28} height={28} />
              <h1>Chat with {PREFERRED_MODEL_LABEL}</h1>
              <p>Pick a model, choose speed and thinking, attach files, and send through your ChatGPT session.</p>
              <div className="suggestions" aria-label="Example prompts">
                {PROMPT_SUGGESTIONS.map((suggestion) => (
                  <button className="suggestion" key={suggestion} onClick={() => setPrompt(suggestion)} type="button">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="prompt">Prompt</label>
          {attachments.length > 0 && (
            <div className="attachments" aria-label="Attached files">
              {attachments.map((attachment) => (
                <AttachmentChip
                  attachment={attachment}
                  key={attachment.id}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
          )}
          <textarea
            id="prompt"
            className="textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask ChatGPT..."
            spellCheck={false}
          />

          <div className="composer-bottom">
            <div className="composer-tools">
              <div className="select-wrap">
                <select
                  aria-label="Model"
                  disabled={modelStatus !== "ready"}
                  id="model"
                  className="select"
                  value={model}
                  onChange={(e) => {
                    const nextModel = e.target.value;
                    setModel(nextModel);
                    if (!supportsFastTier(nextModel)) setServiceTier("auto");
                  }}
                >
                  {modelStatus === "loading" && <option value="">Loading models...</option>}
                  {modelStatus === "ready" &&
                    models.map((m) => (
                      <option key={m} value={m}>{labelModel(m)}</option>
                    ))}
                </select>
                <CaretDown className="select-caret" size={14} />
              </div>
              <div className="tier-toggle" aria-label="Service tier">
                <button
                  className={serviceTier === "auto" ? "tier active" : "tier"}
                  onClick={() => {
                    setServiceTier("auto");
                    setStatusNotice("Speed set to Auto.");
                  }}
                  type="button"
                >
                  Auto
                </button>
                <button
                  className={serviceTier === "fast" ? "tier active" : "tier"}
                  disabled={!supportsFastTier(model)}
                  onClick={() => {
                    setServiceTier("fast");
                    setStatusNotice("Fast will be tried when available; unsupported sessions fall back automatically.");
                  }}
                  type="button"
                >
                  <Lightning size={13} weight="fill" />
                  Fast
                </button>
              </div>
              <div className="tier-toggle thinking-toggle" aria-label="Thinking level">
                {(["low", "medium", "high"] as const).map((level) => (
                  <button
                    className={thinking === level ? "tier active" : "tier"}
                    key={level}
                    onClick={() => {
                      setThinking(level);
                      setStatusNotice(`Thinking set to ${level}.`);
                    }}
                    type="button"
                  >
                    {labelThinking(level)}
                  </button>
                ))}
              </div>
              <button
                aria-label="Attach files"
                className="tool-btn"
                onClick={() => fileRef.current?.click()}
                type="button"
              >
                <Paperclip size={16} />
                Attach
              </button>
              <input
                ref={fileRef}
                className="sr-only"
                multiple
                onChange={(e) => void addAttachments(e.currentTarget.files)}
                type="file"
              />
            </div>
            <button
              className="send"
              type="submit"
              disabled={running || !model || (!prompt.trim() && attachments.length === 0)}
            >
              {running ? <CircleNotch className="spin" size={17} weight="bold" /> : <PaperPlaneRight size={17} weight="fill" />}
              {running ? "Streaming" : "Send"}
            </button>
          </div>
          {modelWarning && <span className="model-note">{modelWarning}</span>}
          {!modelWarning && statusNotice && <span className="model-note">{statusNotice}</span>}
          {!modelWarning && !statusNotice && modelStatus === "ready" && !supportsFastTier(model) && (
            <span className="model-note">Fast is unavailable for this model; Auto will be used.</span>
          )}
        </form>
      </div>
    </div>
  );
}

function rankModels(accountModels: string[]) {
  const unique = [...new Set(accountModels)];
  const priority = new Map(CURATED_MODELS.map((m, index) => [m, index]));
  return unique.sort((a, b) => {
    const aPriority = priority.get(a);
    const bPriority = priority.get(b);
    if (aPriority !== undefined || bPriority !== undefined) {
      return (aPriority ?? 999) - (bPriority ?? 999);
    }
    return a.localeCompare(b);
  });
}

function labelModel(model: string) {
  if (model === PREFERRED_MODEL) return PREFERRED_MODEL_LABEL;
  if (model === "gpt-5.4") return "GPT-5.4";
  if (model === "gpt-5.4-mini") return "GPT-5.4 mini";
  if (model === "gpt-5.3-codex-spark") return "GPT-5.3 Codex Spark";
  if (model.includes("spark")) {
    return model
      .split("-")
      .map((part) => (part === "gpt" ? "GPT" : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(" ");
  }
  return model;
}

function supportsFastTier(model: string) {
  return model === "gpt-5.5" || model === "gpt-5.4";
}

function labelThinking(level: ThinkingLevel) {
  if (level === "medium") return "Med";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function buildRequestHeaders(serviceTier: ServiceTier, thinking: ThinkingLevel) {
  return {
    ...(serviceTier === "fast" ? { [SERVICE_TIER_HEADER]: "fast" } : {}),
    [REASONING_EFFORT_HEADER]: thinking,
  };
}

function buildMessages(prompt: string, attachments: AttachmentItem[]) {
  if (attachments.length === 0) return [{ role: "user" as const, content: prompt }];
  return [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: prompt },
        ...attachments.map((attachment) => ({
          type: "file" as const,
          data: attachment.dataUrl,
          mediaType: attachment.type,
          filename: attachment.name,
        })),
      ],
    },
  ];
}

function buildReasoning(model: string, serviceTier: ServiceTier, thinking: ThinkingLevel, attachments: AttachmentItem[]) {
  return [
    `Model: ${model}.`,
    `Speed: ${serviceTier === "fast" ? "fast when available" : "auto"}.`,
    `Thinking: ${thinking}.`,
    attachments.length > 0
      ? `Attachments: ${attachments.length} file${attachments.length === 1 ? "" : "s"}.`
      : "Attachments: none.",
    "Transport: /api/chatgpt/responses.",
  ];
}

function getRequestErrorMessage(error: unknown) {
  if (error instanceof ChatGPTProxyError && error.status === 401) {
    return "Your local session expired. Sign in again to continue.";
  }
  return error instanceof Error ? error.message : "Request failed.";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: globalThis.File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

function AttachmentChip({
  attachment,
  onRemove,
  readonly = false,
}: {
  attachment: AttachmentItem;
  onRemove: () => void;
  readonly?: boolean;
}) {
  const isImage = attachment.type.startsWith("image/");
  return (
    <span className="attachment">
      {attachment.url ? (
        <img alt="" className="attachment-preview" src={attachment.url} />
      ) : isImage ? (
        <ImageSquare size={16} />
      ) : (
        <FileIcon size={16} />
      )}
      <span className="attachment-text">
        <span className="attachment-name">{attachment.name}</span>
        <span className="attachment-meta">{formatBytes(attachment.size)}</span>
      </span>
      {!readonly && (
        <button aria-label={`Remove ${attachment.name}`} className="attachment-remove" onClick={onRemove} type="button">
          <X size={12} weight="bold" />
        </button>
      )}
    </span>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
