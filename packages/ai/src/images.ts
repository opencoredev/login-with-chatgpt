import type { FetchLike } from "@opencoredev/loginwithchatgpt-core";

export type ChatGPTImageFormat = "png" | "jpeg" | "webp";
export type ChatGPTImageQuality = "auto" | "low" | "medium" | "high";
export type ChatGPTImageBackground = "auto" | "opaque" | "transparent";
export type ChatGPTImageInputFidelity = "low" | "high";
export type ChatGPTImageSize = "auto" | `${number}x${number}`;

/** An image supplied to {@link ChatGPTImagesClient.edit}. */
export interface ChatGPTImageInput {
  /** A remote URL, data URL, raw base64 string, Blob, ArrayBuffer, or byte array. */
  data: string | URL | Blob | ArrayBuffer | Uint8Array;
  /** Required when `data` is a raw base64 string or raw bytes without a Blob type. */
  mediaType?: `image/${string}`;
  /** Input inspection detail. Defaults to `auto`. */
  detail?: "auto" | "low" | "high";
}

export interface ChatGPTImageOptions {
  /** A mainline model returned by `chatgpt.listModels()`. */
  model?: string;
  /** GPT Image model override. By default the Responses tool selects the image model. */
  imageModel?: string;
  /** Output dimensions. GPT Image 2 accepts custom dimensions that satisfy its size constraints. */
  size?: ChatGPTImageSize;
  quality?: ChatGPTImageQuality;
  format?: ChatGPTImageFormat;
  /** JPEG/WebP compression from 0 to 100. */
  compression?: number;
  background?: ChatGPTImageBackground;
  /** Number of independently generated results. Defaults to 1. */
  n?: number;
  /** Number of intermediate images requested for each result, from 0 to 3. */
  partialImages?: number;
  /** Receives intermediate images while a result is being generated. */
  onPartialImage?: (image: ChatGPTPartialImage) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface ChatGPTGenerateImageOptions extends ChatGPTImageOptions {
  prompt: string;
}

export interface ChatGPTEditImageOptions extends ChatGPTImageOptions {
  prompt: string;
  /** One or more source images to edit or combine. */
  images: readonly ChatGPTImageInput[];
  /** Optional mask. Transparent mask regions identify the area to replace. */
  mask?: ChatGPTImageInput;
  /** Controls how strongly the output preserves details from the input image. */
  inputFidelity?: ChatGPTImageInputFidelity;
}

export interface ChatGPTGeneratedImage {
  /** Base64-encoded image bytes. */
  base64: string;
  /** Ready-to-render data URL. */
  dataUrl: string;
  mediaType: `image/${string}`;
  format: ChatGPTImageFormat;
  /** Upstream image-generation call id, when present. */
  id?: string;
  /** The prompt rewritten by the image tool, when returned upstream. */
  revisedPrompt?: string;
}

export interface ChatGPTPartialImage extends ChatGPTGeneratedImage {
  /** Zero-based final-result index when `n` is greater than one. */
  imageIndex: number;
  /** Zero-based intermediate-image index from the upstream event. */
  partialImageIndex: number;
}

export interface ChatGPTImageResult {
  data: ChatGPTGeneratedImage[];
}

export interface ChatGPTImagesClient {
  /** Generates one or more images from a prompt. */
  generate(options: ChatGPTGenerateImageOptions): Promise<ChatGPTImageResult>;
  /** Edits, combines, or transforms one or more supplied images. */
  edit(options: ChatGPTEditImageOptions): Promise<ChatGPTImageResult>;
}

export class ChatGPTImageError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly detail?: unknown;

  constructor(message: string, options: { status?: number; code?: string; detail?: unknown } = {}) {
    super(message);
    this.name = "ChatGPTImageError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
  }
}

interface CreateChatGPTImagesClientOptions {
  fetch: FetchLike;
  responsesUrl: string;
  defaultModel: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

interface ImageGenerationCall {
  id?: string;
  result: string;
  revised_prompt?: string;
}

interface ImageRequestOptions extends ChatGPTImageOptions {
  prompt: string;
  action: "generate" | "edit";
  images?: readonly ChatGPTImageInput[];
  mask?: ChatGPTImageInput;
  inputFidelity?: ChatGPTImageInputFidelity;
}

export function createChatGPTImagesClient(options: CreateChatGPTImagesClientOptions): ChatGPTImagesClient {
  return {
    generate: (request) => runImageRequests(options, { ...request, action: "generate" }),
    edit: (request) => {
      if (!Array.isArray(request.images) || !request.images.length) {
        throw new TypeError("`images` must contain at least one source image.");
      }
      return runImageRequests(options, { ...request, action: "edit" });
    },
  };
}

async function runImageRequests(
  client: CreateChatGPTImagesClientOptions,
  options: ImageRequestOptions,
): Promise<ChatGPTImageResult> {
  validateOptions(options);
  const count = options.n ?? 1;
  const data = await Promise.all(
    Array.from({ length: count }, (_, imageIndex) => runImageRequest(client, options, imageIndex)),
  );
  return { data };
}

async function runImageRequest(
  client: CreateChatGPTImagesClientOptions,
  options: ImageRequestOptions,
  imageIndex: number,
): Promise<ChatGPTGeneratedImage> {
  const format = options.format ?? "png";
  const mediaType = mediaTypeFor(format);
  const tool: Record<string, unknown> = {
    type: "image_generation",
    action: options.action,
  };

  setIfDefined(tool, "model", options.imageModel);
  setIfDefined(tool, "size", options.size);
  setIfDefined(tool, "quality", options.quality);
  setIfDefined(tool, "output_format", options.format);
  setIfDefined(tool, "output_compression", options.compression);
  setIfDefined(tool, "background", options.background);
  setIfDefined(tool, "partial_images", options.partialImages);
  setIfDefined(tool, "input_fidelity", options.inputFidelity);

  if (options.mask) {
    tool["input_image_mask"] = { image_url: await toImageUrl(options.mask) };
  }

  const input = options.images
    ? [
        {
          role: "user",
          content: [
            { type: "input_text", text: options.prompt },
            ...(await Promise.all(
              options.images.map(async (image) => ({
                type: "input_image",
                image_url: await toImageUrl(image),
                detail: image.detail ?? "auto",
              })),
            )),
          ],
        },
      ]
    : options.prompt;

  const headers = new Headers(client.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "text/event-stream, application/json");

  const response = await client.fetch(client.responsesUrl, {
    method: "POST",
    headers,
    credentials: client.credentials,
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? client.defaultModel,
      input,
      stream: true,
      tools: [tool],
      tool_choice: { type: "image_generation" },
    }),
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    const upstream = getRecord(detail);
    const nested = getRecord(upstream?.["error"]);
    const message =
      readString(nested?.["message"]) ??
      readString(upstream?.["message"]) ??
      readString(upstream?.["detail"]) ??
      `Image request failed (${response.status}).`;
    throw new ChatGPTImageError(message, {
      status: response.status,
      code: readString(nested?.["code"]) ?? readString(upstream?.["error"]),
      detail,
    });
  }

  const call = await readImageResponse(response, async (base64, partialImageIndex) => {
    await options.onPartialImage?.({
      base64,
      dataUrl: `data:${mediaType};base64,${base64}`,
      mediaType,
      format,
      imageIndex,
      partialImageIndex,
    });
  });

  return {
    base64: call.result,
    dataUrl: `data:${mediaType};base64,${call.result}`,
    mediaType,
    format,
    ...(call.id ? { id: call.id } : {}),
    ...(call.revised_prompt ? { revisedPrompt: call.revised_prompt } : {}),
  };
}

async function readImageResponse(
  response: Response,
  onPartialImage: (base64: string, partialImageIndex: number) => Promise<void>,
): Promise<ImageGenerationCall> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const value: unknown = await response.json();
    const call = findImageCall(value);
    if (call) return call;
    throw imageResponseError(value);
  }

  if (!response.body) {
    throw new ChatGPTImageError("Image response had no body.", { code: "empty_image_response" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalCall: ImageGenerationCall | undefined;
  let streamError: ChatGPTImageError | undefined;

  const consumeBlock = async (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    const record = getRecord(event);
    if (record?.["type"] === "response.image_generation_call.partial_image") {
      const base64 = readString(record["partial_image_b64"]);
      if (base64) await onPartialImage(base64, readNumber(record["partial_image_index"]) ?? 0);
    }

    finalCall = findImageCall(event) ?? finalCall;
    const type = readString(record?.["type"]);
    if (type === "response.failed" || type === "error") {
      streamError = imageResponseError(event);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) await consumeBlock(block);
      if (done) break;
    }
    if (buffer.trim()) await consumeBlock(buffer);
  } finally {
    reader.releaseLock();
  }

  if (finalCall) return finalCall;
  if (streamError) throw streamError;
  throw new ChatGPTImageError("The response completed without an image.", { code: "no_image_generated" });
}

function findImageCall(value: unknown): ImageGenerationCall | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageCall(item);
      if (found) return found;
    }
    return undefined;
  }

  const record = getRecord(value);
  if (!record) return undefined;
  if (record["type"] === "image_generation_call" && typeof record["result"] === "string") {
    return {
      result: record["result"],
      ...(typeof record["id"] === "string" ? { id: record["id"] } : {}),
      ...(typeof record["revised_prompt"] === "string" ? { revised_prompt: record["revised_prompt"] } : {}),
    };
  }

  for (const key of ["item", "output", "response", "data"]) {
    const found = findImageCall(record[key]);
    if (found) return found;
  }
  return undefined;
}

function imageResponseError(value: unknown): ChatGPTImageError {
  const record = getRecord(value);
  const response = getRecord(record?.["response"]);
  const error = getRecord(response?.["error"]) ?? getRecord(record?.["error"]);
  const message =
    readString(error?.["message"]) ??
    readString(response?.["incomplete_details"]) ??
    "The response completed without an image.";
  return new ChatGPTImageError(message, {
    code: readString(error?.["code"]) ?? "no_image_generated",
    detail: value,
  });
}

async function toImageUrl(input: ChatGPTImageInput): Promise<string> {
  if (input.data instanceof URL) return input.data.toString();
  if (typeof input.data === "string") {
    if (/^(?:https?:|data:)/i.test(input.data)) return input.data;
    if (!input.mediaType) {
      throw new TypeError("`mediaType` is required when image data is a raw base64 string.");
    }
    return `data:${input.mediaType};base64,${input.data}`;
  }

  if (input.data instanceof Blob) {
    const mediaType = input.mediaType ?? (input.data.type.startsWith("image/") ? input.data.type : undefined);
    if (!mediaType) throw new TypeError("`mediaType` is required when the Blob has no image type.");
    return `data:${mediaType};base64,${bytesToBase64(new Uint8Array(await input.data.arrayBuffer()))}`;
  }

  const bytes = input.data instanceof ArrayBuffer
    ? new Uint8Array(input.data)
    : new Uint8Array(input.data.buffer, input.data.byteOffset, input.data.byteLength);
  if (!input.mediaType) throw new TypeError("`mediaType` is required when image data is raw bytes.");
  return `data:${input.mediaType};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function validateOptions(options: ImageRequestOptions): void {
  if (!options.prompt.trim()) throw new TypeError("`prompt` must not be empty.");
  if (options.n !== undefined && (!Number.isInteger(options.n) || options.n < 1 || options.n > 10)) {
    throw new RangeError("`n` must be an integer from 1 to 10.");
  }
  if (
    options.partialImages !== undefined &&
    (!Number.isInteger(options.partialImages) || options.partialImages < 0 || options.partialImages > 3)
  ) {
    throw new RangeError("`partialImages` must be an integer from 0 to 3.");
  }
  if (
    options.compression !== undefined &&
    (!Number.isInteger(options.compression) || options.compression < 0 || options.compression > 100)
  ) {
    throw new RangeError("`compression` must be an integer from 0 to 100.");
  }
  if (options.size && options.size !== "auto") validateSize(options.size);
}

function validateSize(size: `${number}x${number}`): void {
  const match = /^(\d+)x(\d+)$/.exec(size);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const pixels = width * height;
  if (
    !match ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    longEdge > 3840 ||
    longEdge / shortEdge > 3 ||
    pixels < 655_360 ||
    pixels > 8_294_400
  ) {
    throw new RangeError(
      "`size` edges must be multiples of 16 up to 3840px, have at most a 3:1 ratio, and contain 655,360-8,294,400 pixels.",
    );
  }
}

function mediaTypeFor(format: ChatGPTImageFormat): `image/${string}` {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function setIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
