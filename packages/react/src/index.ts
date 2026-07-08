/**
 * @loginwithchatgpt/react
 *
 * React building blocks for Login with ChatGPT: the `useLoginWithChatGPT` hook
 * that drives the device-code flow against your backend handler, and a styled
 * `<LoginWithChatGPT />` widget built on top of it.
 */

export {
  useLoginWithChatGPT,
  type UseLoginWithChatGPTOptions,
  type UseLoginWithChatGPTResult,
  type LoginWithChatGPTState,
  type LoginWithChatGPTLoginOptions,
  type ClientLoginStatus,
} from "./useLoginWithChatGPT.ts";
export {
  LoginWithChatGPT,
  type LoginWithChatGPTConsentOptions,
  type LoginWithChatGPTProps,
  type OpenLoginWithChatGPTConsentPopupOptions,
  openLoginWithChatGPTConsentPopup,
} from "./LoginWithChatGPT.tsx";
export { ChatGPTMark, OpenAIMark, Spinner } from "./icons.tsx";
export type { ChatGPTUser } from "@loginwithchatgpt/core";
