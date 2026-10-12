import { Readable } from "stream";
import { StringDecoder } from "string_decoder";

export class ChatStreamError extends Error {}

export function translationAborted() {
  const error = new Error("翻译已取消");
  error.name = "AbortError";
  return error;
}

// Chat Completions SSE frames can span TCP chunks, including UTF-8 characters.
// Only delta.content is a translation; reasoning/tool calls are not displayed.
export async function readChatStream(
  stream: Readable,
  onProgress: (text: string) => void,
  signal?: AbortSignal,
  jsonResponse = false,
  onDelta?: (kind: "content" | "reasoning") => void
): Promise<string> {
  const decoder = new StringDecoder("utf8");
  let buffer = "", text = "", finished = false, done = false;
  let received = 0, lastPublished = "", lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const publish = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!signal?.aborted && text !== lastPublished) {
      lastPublished = text;
      lastTime = Date.now();
      onProgress(text);
    }
  };
  const update = () => {
    if (Date.now() - lastTime >= 40) publish();
    else if (!timer) timer = setTimeout(publish, 40);
  };
  const abort = () => stream.destroy(translationAborted());
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stream.destroy(new ChatStreamError("流式响应超时，请重试。")), 60000);
  };
  const frame = (value: string) => {
    const data = value.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, "")).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    let event: any;
    try { event = JSON.parse(data); }
    catch { throw new ChatStreamError("模型返回的流式数据格式不正确，请重试。"); }
    if (event.error) throw new ChatStreamError("模型在生成过程中返回错误，请重试或更换模型。");
    const choice = event.choices?.find((item: any) => item.index === 0) || event.choices?.[0];
    if (typeof choice?.delta?.reasoning_content === "string" && choice.delta.reasoning_content) onDelta?.("reasoning");
    if (typeof choice?.delta?.content === "string" && choice.delta.content) {
      onDelta?.("content");
      text += choice.delta.content;
      update();
    }
    if (choice?.finish_reason === "length") throw new ChatStreamError("译文未完成：已达到输出 Token 上限，请提高上限或缩短原文。");
    if (choice?.finish_reason === "content_filter") throw new ChatStreamError("服务商中止了本次生成，请调整原文或更换模型。");
    if (choice?.finish_reason) finished = true;
  };
  if (signal?.aborted) { stream.destroy(); throw translationAborted(); }
  signal?.addEventListener("abort", abort, { once: true });
  resetIdle();
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw translationAborted();
      resetIdle();
      received += Buffer.byteLength(chunk);
      if (received > 2 * 1024 * 1024) throw new ChatStreamError("模型响应过长，请缩短原文后重试。");
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      if (jsonResponse) continue;
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (done) break;
      }
      if (done) break;
    }
    buffer += decoder.end();
    if (jsonResponse) {
      let result: any;
      try { result = JSON.parse(buffer); }
      catch { throw new ChatStreamError("模型返回的数据格式不正确，请检查接口地址。"); }
      if (result.choices?.[0]?.finish_reason === "length") throw new ChatStreamError("译文未完成：已达到输出 Token 上限，请提高上限或缩短原文。");
      text = result.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new ChatStreamError("服务未返回译文，请检查模型是否支持文本对话。");
    } else {
      if (!done && buffer.trim()) frame(buffer);
      if (!done && !finished) throw new ChatStreamError("连接已中断，译文尚未完成，请重试。");
    }
    if (!text.trim()) throw new ChatStreamError("服务未返回译文，请检查模型是否支持文本对话。");
    publish();
    return text;
  } finally {
    clearTimeout(idle!);
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    stream.destroy();
  }
}
