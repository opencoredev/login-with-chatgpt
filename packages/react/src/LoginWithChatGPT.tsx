"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { ChatGPTMark, Spinner } from "./icons.tsx";
import {
  type UseLoginWithChatGPTOptions,
  type UseLoginWithChatGPTResult,
  useLoginWithChatGPT,
} from "./useLoginWithChatGPT.ts";

export interface LoginWithChatGPTProps extends UseLoginWithChatGPTOptions {
  /** Button label. Defaults to "Login with ChatGPT". */
  label?: string;
  /**
   * Customizes the usage-risk consent step shown before the OpenAI
   * verification flow. The consent step itself always renders — signing in
   * gives the app spending power over the user's ChatGPT plan, so the default
   * widget never starts a login without informed consent. (If the popup is
   * blocked, the same consent renders inline instead.) Custom `children`
   * renderers take over this responsibility themselves.
   */
  consent?: LoginWithChatGPTConsentOptions;
  className?: string;
  style?: CSSProperties;
  /**
   * Full custom rendering. Receives the same state/actions as
   * {@link useLoginWithChatGPT}; when provided, the default UI is bypassed.
   */
  children?: (state: UseLoginWithChatGPTResult) => ReactNode;
}

export interface LoginWithChatGPTConsentOptions {
  /** Product/app name shown in the consent copy. Defaults to "this app". */
  appName?: string;
  /** Primary button copy on the consent step. */
  continueLabel?: string;
  /** Link to your own privacy/security page. */
  securityHref?: string;
}

const STYLE_ID = "lwc-styles";
const OPENAI_ACTIVE_SESSIONS_HELP_URL = "https://help.openai.com/en/articles/20001257-managing-active-sessions-in-chatgpt";
const POPUP_FEATURES = "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=yes";

const STYLESHEET = `
.lwc-root{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:inline-flex;flex-direction:column;gap:12px;align-items:stretch;min-width:260px}
.lwc-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#0d0d0d;border:none;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.18);transition:transform .12s ease,box-shadow .12s ease,opacity .12s ease;line-height:1}
.lwc-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 2px 4px rgba(0,0,0,.28),0 12px 32px rgba(0,0,0,.22)}
.lwc-btn:active:not(:disabled){transform:translateY(0)}
.lwc-btn:focus-visible{outline:2px solid #10a37f;outline-offset:2px}
.lwc-btn:disabled{cursor:default;opacity:.85}
.lwc-card{background:rgba(28,28,30,.9);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px 20px;color:#ececf1;display:flex;flex-direction:column;gap:8px;text-align:center;backdrop-filter:blur(8px)}
.lwc-card-label{font-size:12px;color:#8e8ea0;letter-spacing:.01em}
.lwc-code-row{display:flex;align-items:center;justify-content:center;gap:10px}
.lwc-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:600;letter-spacing:.12em;color:#fff}
.lwc-copy{background:transparent;border:1px solid rgba(255,255,255,.16);color:#c5c5d2;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;transition:background .12s ease,color .12s ease}
.lwc-copy:hover{background:rgba(255,255,255,.08);color:#fff}
.lwc-copy[data-copied="true"]{color:#3fb950;border-color:rgba(63,185,80,.4)}
.lwc-copied-note{font-size:12.5px;font-weight:500;color:#3fb950;display:inline-flex;align-items:center;gap:6px;justify-content:center}
.lwc-hint{font-size:12px;color:#6e6e80;line-height:1.5}
.lwc-link{color:#10a37f;text-decoration:none;font-size:13px;font-weight:500}
.lwc-link:hover{text-decoration:underline}
.lwc-waiting{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#ececf1;color:#0d0d0d;border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600}
.lwc-loading{display:inline-flex;align-items:center;justify-content:center;gap:10px;color:#8b8b92;font-size:14px}
.lwc-chip{display:inline-flex;align-items:center;gap:12px;background:rgba(28,28,30,.9);border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:8px 8px 8px 8px;color:#ececf1}
.lwc-avatar{width:32px;height:32px;border-radius:999px;background:#10a37f;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex:none}
.lwc-identity{display:flex;flex-direction:column;text-align:left;line-height:1.25;padding-right:4px}
.lwc-identity-name{font-size:13px;font-weight:600}
.lwc-identity-plan{font-size:11px;color:#8e8ea0;text-transform:capitalize}
.lwc-disconnect{margin-left:auto;background:transparent;border:none;color:#8e8ea0;font-size:13px;cursor:pointer;padding:6px 12px;border-radius:999px}
.lwc-disconnect:hover{color:#fff;background:rgba(255,255,255,.06)}
.lwc-error{font-size:13px;color:#f85149}
.lwc-consent{text-align:left;gap:12px;max-width:392px}
.lwc-consent-title{font-size:15px;font-weight:650;color:#fff}
.lwc-consent-list{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.lwc-consent-list li{color:#b8b8c2;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.45}
`;

/** Injects the component stylesheet once per document (client only). */
function useLoginWithChatGPTStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLESHEET;
    document.head.appendChild(el);
  }, []);
}

/**
 * A drop-in "Login with ChatGPT" widget: renders a button, the device-code
 * waiting card, and the signed-in chip, driven by {@link useLoginWithChatGPT}.
 * Pass a `children` render function for full control over the markup.
 */
export function LoginWithChatGPT(props: LoginWithChatGPTProps): ReactNode {
  const { label = "Login with ChatGPT", consent, className, style, children, ...hookOptions } = props;
  const state = useLoginWithChatGPT(hookOptions);
  // Guard against `consent={false as any}` from pre-release code: the consent
  // step is not skippable, only customizable.
  const consentOptions = consent && typeof consent === "object" ? consent : {};
  // Fallback for blocked popups: render the same consent inline instead of
  // silently starting a login the user never agreed to.
  const [showInlineConsent, setShowInlineConsent] = useState(false);
  useLoginWithChatGPTStyles(); // inject styles whether or not a custom renderer is used

  if (children) return children(state);

  const rootClass = className ? `lwc-root ${className}` : "lwc-root";

  return (
    <div className={rootClass} style={style}>
      {state.status === "authenticated" ? (
        <SignedIn state={state} />
      ) : state.status === "loading" ? (
        <span className="lwc-loading">
          <Spinner /> Checking session…
        </span>
      ) : state.status === "pending" ? (
        <PendingCard state={state} />
      ) : showInlineConsent ? (
        <InlineConsent
          options={consentOptions}
          isConnecting={state.isConnecting}
          onContinue={() => {
            setShowInlineConsent(false);
            void state.login();
          }}
          onCancel={() => setShowInlineConsent(false)}
        />
      ) : (
        <button
          type="button"
          className="lwc-btn"
          onClick={() => {
            const popup = openLoginWithChatGPTConsentPopup({ ...consentOptions, login: state.login });
            if (!popup) setShowInlineConsent(true);
          }}
          disabled={state.isConnecting}
        >
          {state.isConnecting ? <Spinner /> : <ChatGPTMark />}
          {state.isConnecting ? "Connecting…" : label}
        </button>
      )}
      {state.error ? <span className="lwc-error">{state.error}</span> : null}
    </div>
  );
}

function InlineConsent({
  options,
  isConnecting,
  onContinue,
  onCancel,
}: {
  options: LoginWithChatGPTConsentOptions;
  isConnecting: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const appName = options.appName ?? "this app";
  return (
    <div className="lwc-card lwc-consent">
      <span className="lwc-consent-title">Authorize {appName} to use ChatGPT?</span>
      <ul className="lwc-consent-list">
        {consentBullets(appName).map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      {options.securityHref ? (
        <a className="lwc-link" href={options.securityHref} target="_blank" rel="noreferrer">
          Security details ↗
        </a>
      ) : null}
      <button type="button" className="lwc-btn" onClick={onContinue} disabled={isConnecting}>
        {isConnecting ? "Connecting…" : options.continueLabel ?? "I trust this app, continue"}
      </button>
      <button type="button" className="lwc-copy" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Single source of truth for the consent warning, shared by popup and inline fallback. */
function consentBullets(appName: string): string[] {
  return [
    `${appName} can send AI requests billed to your own ChatGPT plan until you disconnect. Heavy or runaway use can exhaust your plan's usage limits.`,
    `Your prompts and files pass through ${appName}'s server before reaching OpenAI. Only continue if you trust its developer.`,
    `${appName} never sees your ChatGPT password, and this access cannot be used to sign in to ChatGPT as you — it only allows AI requests.`,
    `Disconnect anytime with the sign-out button in ${appName}; that deletes its stored session.`,
  ];
}

export interface OpenLoginWithChatGPTConsentPopupOptions extends LoginWithChatGPTConsentOptions {
  login: UseLoginWithChatGPTResult["login"];
}

export function openLoginWithChatGPTConsentPopup(options: OpenLoginWithChatGPTConsentPopupOptions): Window | null {
  if (typeof window === "undefined") return null;
  const popup = window.open("", "login-with-chatgpt", POPUP_FEATURES);
  if (!popup) return null;

  const appName = options.appName ?? "this app";
  const continueLabel = options.continueLabel ?? "I trust this app, continue";
  const openerWithCallbacks = window as Window & {
    __loginWithChatGPTContinue?: (target: Window) => void;
    __loginWithChatGPTCancel?: () => void;
  };
  openerWithCallbacks.__loginWithChatGPTContinue = (target) => {
    const continueButton = popup.document.getElementById("continue");
    continueButton?.setAttribute("disabled", "true");
    if (continueButton) continueButton.textContent = "Opening OpenAI...";
    void options.login({ popup: target });
  };
  openerWithCallbacks.__loginWithChatGPTCancel = () => popup.close();
  popup.document.open();
  popup.document.write(renderConsentPopupHtml({ appName, continueLabel, securityHref: options.securityHref }));
  popup.document.close();
  popup.focus();

  return popup;
}

function renderConsentPopupHtml({
  appName,
  continueLabel,
  securityHref,
}: {
  appName: string;
  continueLabel: string;
  securityHref?: string;
}) {
  const safeAppName = escapeHtml(appName);
  const safeContinueLabel = escapeHtml(continueLabel);
  const safeSecurityHref = securityHref ? escapeAttribute(securityHref) : undefined;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${safeAppName}</title>
  <style>
    :root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#202123;color:#ececf1}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:#202123}
    main{width:min(100%,392px);display:flex;flex-direction:column;gap:16px}
    .mark{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.28);color:#fbbf24;font-size:22px;font-weight:700}
    h1{margin:0;font-size:28px;line-height:1.12;font-weight:650;letter-spacing:0}
    p{margin:0;color:#c5c5d2;font-size:15px;line-height:1.5}
    ul{display:flex;flex-direction:column;gap:10px;list-style:none;margin:0;padding:0}
    li{color:#b8b8c2;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.45}
    .links{display:flex;gap:12px;flex-wrap:wrap}
    a{color:#c5c5d2;font-size:13px;text-decoration:underline;text-underline-offset:3px}
    .actions{display:flex;gap:10px;flex-direction:column;margin-top:2px}
    button{min-height:48px;border-radius:999px;font:inherit;font-weight:650;cursor:pointer}
    #continue{border:0;background:#fff;color:#0d0d0d;padding:0 18px}
    #continue:disabled{opacity:.72;cursor:default}
    #close{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c5c5d2;padding:0 18px}
  </style>
</head>
<body>
  <main>
    <div class="mark">!</div>
    <h1>Authorize ${safeAppName} to use ChatGPT</h1>
    <p>Continue only if you trust ${safeAppName} and its developer.</p>
    <ul>
      ${consentBullets(appName)
        .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
        .join("\n      ")}
    </ul>
    <div class="links">
      ${safeSecurityHref ? `<a href="${safeSecurityHref}" target="_blank" rel="noreferrer">Security details</a>` : ""}
      <a href="${OPENAI_ACTIVE_SESSIONS_HELP_URL}" target="_blank" rel="noreferrer">OpenAI sessions help</a>
    </div>
    <div class="actions">
      <button id="continue" type="button" onclick="window.opener && window.opener.__loginWithChatGPTContinue && window.opener.__loginWithChatGPTContinue(window)">${safeContinueLabel}</button>
      <button id="close" type="button" onclick="window.opener && window.opener.__loginWithChatGPTCancel ? window.opener.__loginWithChatGPTCancel() : window.close()">Cancel</button>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function PendingCard({ state }: { state: UseLoginWithChatGPTResult }) {
  return (
    <>
      <span className="lwc-waiting">
        <Spinner /> Waiting for login…
      </span>
      <div className="lwc-card">
        <span className="lwc-card-label">Enter this code in the opened browser tab</span>
        <div className="lwc-code-row">
          <span className="lwc-code">{state.userCode}</span>
          <button
            type="button"
            className="lwc-copy"
            data-copied={state.copied}
            onClick={() => void state.copyCode()}
          >
            {state.copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        {state.copied ? (
          <span className="lwc-copied-note">✓ Copied to your clipboard. Paste it in the verification window.</span>
        ) : null}
        {state.verificationUrl ? (
          <a className="lwc-link" href={state.verificationUrl} target="_blank" rel="noreferrer">
            Open verification page ↗
          </a>
        ) : null}
        <span className="lwc-hint">
          Checking automatically. This usually updates a few seconds after you enter the code.
        </span>
      </div>
    </>
  );
}

function SignedIn({ state }: { state: UseLoginWithChatGPTResult }) {
  return (
    <div className="lwc-chip">
      <span className="lwc-avatar">C</span>
      <span className="lwc-identity">
        <span className="lwc-identity-name">Connected</span>
        {state.user?.plan ? <span className="lwc-identity-plan">{state.user.plan} plan</span> : null}
      </span>
      <button type="button" className="lwc-disconnect" onClick={() => void state.logout()}>
        Disconnect
      </button>
    </div>
  );
}
