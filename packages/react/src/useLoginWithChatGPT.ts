"use client";

import type { ChatGPTUser, LoginStatus } from "@loginwithchatgpt/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** Client-side status: the server statuses plus transient hydration/connecting phases. */
export type ClientLoginStatus = LoginStatus | "loading" | "connecting";

export interface UseLoginWithChatGPTOptions {
  /** Base path of your mounted server handler. Defaults to `/api/chatgpt`. */
  basePath?: string;
  /** Custom fetch (defaults to the global). */
  fetch?: typeof fetch;
  /** How often to poll `/status` while a login is pending. Defaults to 2500ms. */
  pollIntervalMs?: number;
  /** Open the verification page in a popup automatically. Defaults to `true`. */
  openPopup?: boolean;
  /** Copy the user code to the clipboard when a login starts. Defaults to `true`. */
  autoCopyCode?: boolean;
  onAuthenticated?: (user: ChatGPTUser | undefined) => void;
  onError?: (error: Error) => void;
}

export interface LoginWithChatGPTState {
  status: ClientLoginStatus;
  user?: ChatGPTUser;
  /** Short code the user enters on the verification page (while pending). */
  userCode?: string;
  /** Verification URL the user opens to enter the code (while pending). */
  verificationUrl?: string;
  /** `true` briefly after the code is copied to the clipboard. */
  copied: boolean;
  error?: string;
}

export interface LoginWithChatGPTLoginOptions {
  /** Existing popup window to navigate to the OpenAI verification page. */
  popup?: Window | null;
}

export interface UseLoginWithChatGPTResult extends LoginWithChatGPTState {
  /** Starts the device-code login: fetches a code, opens the popup, begins polling. */
  login: (options?: LoginWithChatGPTLoginOptions) => Promise<void>;
  /** Signs the user out and clears the session. */
  logout: () => Promise<void>;
  /** Copies the current user code to the clipboard. */
  copyCode: () => Promise<void>;
  /** Re-focuses (or re-opens) the verification popup window — not a new tab. */
  reopen: () => void;
  isAuthenticated: boolean;
  isPending: boolean;
  isConnecting: boolean;
}

/** Window features that make `window.open` produce a popup window, not a tab. */
const POPUP_FEATURES = "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=yes";

interface StatusResponse {
  status: LoginStatus;
  user?: ChatGPTUser;
}

interface LoginResponse {
  status: LoginStatus;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
}

/**
 * Drives the Login with ChatGPT device-code flow from the browser against your
 * backend handler. Owns the popup, clipboard, and status polling, and exposes a
 * simple state machine you can render however you like.
 */
export function useLoginWithChatGPT(
  options: UseLoginWithChatGPTOptions = {},
): UseLoginWithChatGPTResult {
  const {
    basePath = "/api/chatgpt",
    pollIntervalMs = 2500,
    openPopup = true,
    autoCopyCode = true,
  } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  const [state, setState] = useState<LoginWithChatGPTState>({ status: "loading", copied: false });

  // Stable refs so effects and callbacks don't churn on every render.
  const popupRef = useRef<Window | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const request = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await doFetch(`${basePath}${path}`, {
        credentials: "same-origin",
        ...init,
      });
      if (!response.ok) throw new Error(`Request to ${path} failed (${response.status}).`);
      return (await response.json()) as T;
    },
    [basePath, doFetch],
  );

  const copyCode = useCallback(async () => {
    const code = state.userCode;
    if (!code || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code);
      setState((prev) => ({ ...prev, copied: true }));
    } catch {
      // clipboard permission denied — the code is still visible for manual entry
    }
  }, [state.userCode]);

  const reopen = useCallback(() => {
    if (typeof window === "undefined") return;
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const url = state.verificationUrl;
    if (url) popupRef.current = window.open(url, "login-with-chatgpt", POPUP_FEATURES);
  }, [state.verificationUrl]);

  const login = useCallback(async (loginOptions: LoginWithChatGPTLoginOptions = {}) => {
    setState({ status: "connecting", copied: false });
    try {
      const data = await request<LoginResponse>("/login", { method: "POST" });

      // Copy the code BEFORE opening the popup. Opening a window first steals
      // focus from this document, and `clipboard.writeText` rejects when the
      // document isn't focused — which is why auto-copy silently failed.
      let copied = false;
      const clipboard = loginOptions.popup && !loginOptions.popup.closed
        ? loginOptions.popup.navigator.clipboard
        : typeof navigator !== "undefined"
          ? navigator.clipboard
          : undefined;
      if (autoCopyCode && clipboard?.writeText) {
        try {
          await clipboard.writeText(data.userCode);
          copied = true;
        } catch {
          // clipboard denied — the code stays visible with a Copy button
        }
      }

      // Open or navigate the popup after copying. A caller can pass a pre-opened
      // same-window consent popup so the user continues to OpenAI in one place.
      if (openPopup && typeof window !== "undefined") {
        const existing = loginOptions.popup;
        if (existing && !existing.closed) {
          existing.location.href = data.verificationUrl;
          existing.focus();
          popupRef.current = existing;
        } else {
          popupRef.current = window.open(data.verificationUrl, "login-with-chatgpt", POPUP_FEATURES);
        }
      }

      setState({
        status: "pending",
        userCode: data.userCode,
        verificationUrl: data.verificationUrl,
        copied,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Login failed.");
      setState({ status: "error", error: err.message, copied: false });
      optionsRef.current.onError?.(err);
    }
  }, [autoCopyCode, openPopup, request]);

  const logout = useCallback(async () => {
    try {
      await request("/logout", { method: "POST" });
    } catch {
      // best-effort — clear locally regardless
    }
    setState({ status: "unauthenticated", copied: false });
  }, [request]);

  // Hydrate the current session on mount.
  useEffect(() => {
    let active = true;
    request<StatusResponse>("/session")
      .then((data) => {
        if (!active) return;
        if (data.status === "authenticated") {
          setState({ status: "authenticated", user: data.user, copied: false });
        } else {
          setState({ status: "unauthenticated", copied: false });
        }
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "unauthenticated", copied: false });
      });
    return () => {
      active = false;
    };
  }, [request]);

  // Poll for completion while a login is pending.
  useEffect(() => {
    if (state.status !== "pending") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!active) return;
      try {
        const data = await request<StatusResponse>("/status");
        if (!active) return;
        if (data.status === "authenticated") {
          popupRef.current?.close();
          setState((prev) => ({ ...prev, status: "authenticated", user: data.user }));
          optionsRef.current.onAuthenticated?.(data.user);
          return;
        }
        if (data.status === "expired" || data.status === "error") {
          popupRef.current?.close();
          setState((prev) => ({ ...prev, status: data.status }));
          return;
        }
        timer = setTimeout(tick, pollIntervalMs);
      } catch {
        if (!active) return;
        timer = setTimeout(tick, pollIntervalMs);
      }
    };

    timer = setTimeout(tick, pollIntervalMs);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [state.status, pollIntervalMs, request]);

  return {
    ...state,
    login,
    logout,
    copyCode,
    reopen,
    isAuthenticated: state.status === "authenticated",
    isPending: state.status === "pending",
    isConnecting: state.status === "connecting",
  };
}
