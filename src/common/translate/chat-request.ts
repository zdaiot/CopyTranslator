import axios from "axios";
import type { OpenAIConfig } from "./types";
import { buildChatRequest } from "./chat-settings";
import { ChatStreamError, readChatStream, translationAborted } from "./chat-stream";
import { providerHTTPOptions, providerRequestError } from "./provider-http";

// Read only bounded error metadata, never surface vendor bodies/headers/keys.
async function errorMetadata(error: any, signal?: AbortSignal): Promise<{ param?: string; message?: string; code?: string }> {
  let data = error?.response?.data;
  if (typeof data?.[Symbol.asyncIterator] === "function") {
    const stream = data;
    const abort = () => stream.destroy();
    const timer = setTimeout(abort, 3000);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let body = "";
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        body += chunk.toString();
        if (body.length > 65536) return {};
      }
      data = JSON.parse(body);
    } catch { return {}; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); stream.destroy(); }
  }
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return {}; }
  }
  return data?.error && typeof data.error === "object" ? data.error : {};
}

function streamUnsupported(status: number, metadata: { param?: string; message?: string; code?: string }) {
  if (![400, 422, 501].includes(status)) return false;
  const message = typeof metadata.message === "string" ? metadata.message : "";
  const code = typeof metadata.code === "string" ? metadata.code : "";
  if (metadata.param && metadata.param !== "stream") return false;
  if (metadata.param === "stream") return /unsupported|not[_ ]supported|not allowed|does not support|doesn't support|must be false|不支持|不允许/i.test(message + " " + code);
  return /(?:unsupported|不支持)\s+(?:the\s+)?stream(?:ing)?|\bstream(?:ing)?(?:\s+(?:is|are|mode|parameter|option|responses?|requests?))*\s+(?:not supported|not allowed|must be false)|(?:does not|doesn't)\s+support\s+(?:(?:the|this)\s+)?stream(?:ing)?/i.test(message);
}

export async function requestChatCompletion(
  transport: any,
  config: OpenAIConfig,
  messages: Array<{ role: string; content: string }>
) {
  const started = Date.now();
  const request = buildChatRequest(config, messages, !!config.onProgress && config.stream !== false);
  const stats = {
    requestedStream: request.stream, responseMode: "json" as "sse" | "json" | "fallback",
    firstContentMs: null as number | null, firstReasoningMs: null as number | null,
    contentDeltas: 0, reasoningDeltas: 0, elapsedMs: 0,
  };
  const cancellation = axios.CancelToken.source();
  const cancel = () => cancellation.cancel("Translation cancelled");
  if (config.signal?.aborted) throw translationAborted();
  config.signal?.addEventListener("abort", cancel, { once: true });
  const options = { ...providerHTTPOptions(config.apiBase, config.apiKey, 60000, transport.defaults), cancelToken: cancellation.token };
  const apiUrl = config.apiBase.replace(/\/$/, "") + "/chat/completions";
  try {
    let response: any;
    try {
      response = await transport.post(apiUrl, request, { ...options, ...(request.stream ? { responseType: "stream" } : {}) });
    } catch (error) {
      const metadata = await errorMetadata(error, config.signal);
      if (config.signal?.aborted) throw translationAborted();
      // Retry only explicit stream rejection, before any successful response.
      // Keep the user's thinking settings, model and prompt unchanged.
      if (request.stream && streamUnsupported((error as any)?.response?.status, metadata)) {
        response = await transport.post(apiUrl, { ...request, stream: false }, options);
        stats.responseMode = "fallback";
      } else {
        if ([400, 422].includes((error as any)?.response?.status) && /reasoning|thinking/i.test(String(metadata.param) + " " + String(metadata.message))) {
          throw new ChatStreamError("模型不接受当前思考设置，请在高级配置中选择模型支持的强度，或改为“跟随服务商默认”后测试。");
        }
        throw error;
      }
    }
    let text: string;
    if (request.stream && typeof response.data?.[Symbol.asyncIterator] === "function") {
      const json = String(response.headers?.["content-type"]).includes("application/json");
      stats.responseMode = json ? "json" : "sse";
      text = await readChatStream(response.data, config.onProgress!, config.signal, json, kind => {
        if (kind === "content") { stats.firstContentMs ??= Date.now() - started; stats.contentDeltas++; }
        else { stats.firstReasoningMs ??= Date.now() - started; stats.reasoningDeltas++; }
      });
    } else {
      const choice = response.data?.choices?.[0];
      if (choice?.finish_reason === "length") throw new ChatStreamError("译文未完成：已达到输出 Token 上限，请提高上限或缩短原文。");
      text = choice?.message?.content;
    }
    if (typeof text !== "string" || !text.trim()) throw new ChatStreamError("接口已响应，但没有返回文本结果。请检查模型及 Token 设置。");
    stats.firstContentMs ??= Date.now() - started;
    stats.elapsedMs = Date.now() - started;
    return { text, ...stats };
  } catch (error) {
    if (config.signal?.aborted) throw translationAborted();
    (error as any)?.response?.data?.destroy?.();
    if (error instanceof ChatStreamError) throw error;
    throw new ChatStreamError(providerRequestError(error));
  } finally { config.signal?.removeEventListener("abort", cancel); }
}
