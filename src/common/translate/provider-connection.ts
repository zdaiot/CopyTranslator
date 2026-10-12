import * as http from "http";
import * as https from "https";
import { axios } from "./proxy";
import type { ProviderConfig } from "./types";
import { normalizeProviderConnection } from "./provider-config";
export { normalizeProviderConnection } from "./provider-config";

export function providerRequestOptions(apiBase: string, apiKey: string, timeout: number) {
  const host = new URL(apiBase).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.startsWith("192.168.") || host.startsWith("10.");
  return {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout,
    maxRedirects: 0,
    // Preserve the configured proxy, but do not inherit legacy disabled TLS checks.
    ...(axios.defaults?.httpsAgent?.options?.rejectUnauthorized === false ? { httpsAgent: new https.Agent() } : {}),
    ...(local ? { httpAgent: new http.Agent(), httpsAgent: new https.Agent(), proxy: false as const } : {}),
  };
}

export function providerRequestError(error: any): string {
  const status = error?.response?.status;
  if (status === 401) return "密钥无效或已过期（401），请检查 API 密钥。";
  if (status === 403) return "没有访问权限（403），请检查账号及模型授权。";
  if (status === 404) return "接口或模型不存在（404）。请检查 API 地址；若服务不提供模型列表，可手动填写模型 ID 后测试。";
  if (status === 429) return "请求受限或额度不足（429），请检查余额及速率限制后重试。";
  if (status === 400 || status === 422) return "服务不接受当前模型或参数，请检查模型 ID、温度及 Token 设置。";
  if (status >= 300 && status < 400) return "API 地址发生重定向，请填写服务商提供的最终 API 基础地址。";
  if (status >= 500) return `服务商暂时异常（${status}），请稍后重试。`;
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") return "请求超时，请检查网络、代理或稍后重试。";
  return "无法连接 API，请检查网络、代理、证书和 API 基础地址。";
}

export async function testProviderConnection(provider: Pick<ProviderConfig, "apiBase" | "apiKey" | "config">, model: string) {
  const connection = normalizeProviderConnection(provider?.apiBase, provider?.apiKey);
  if (typeof model !== "string" || !model.trim()) throw new Error("请先选择或填写要测试的模型 ID。");
  const started = Date.now();
  let response: any;
  try {
    response = await axios.post(`${connection.apiBase}/chat/completions`, {
      model: model.trim(),
      messages: [{ role: "user", content: 'Translate "Hello" into Simplified Chinese. Return only the translation.' }],
      temperature: provider.config?.temperature ?? 0.3,
      max_tokens: provider.config?.maxTokens ?? 4000,
      stream: false,
    }, providerRequestOptions(connection.apiBase, connection.apiKey, 30000));
  } catch (error) { throw new Error(providerRequestError(error)); }
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("接口已响应，但没有返回文本结果。请确认模型支持 Chat Completions，并检查 Token 设置。");
  }
  return { model: model.trim(), text: content.trim().split(connection.apiKey).join("[已隐藏密钥]").slice(0, 2000), elapsedMs: Date.now() - started };
}
