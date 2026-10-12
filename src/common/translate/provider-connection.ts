import { axios } from "./proxy";
import type { ProviderConfig } from "./types";
import { normalizeProviderConnection } from "./provider-config";
import { providerHTTPOptions } from "./provider-http";
import { requestChatCompletion } from "./chat-request";
import { effectivePrompt } from "./chat-settings";
export { normalizeProviderConnection } from "./provider-config";
export { providerRequestError } from "./provider-http";

export function providerRequestOptions(apiBase: string, apiKey: string, timeout: number) {
  return providerHTTPOptions(apiBase, apiKey, timeout, axios.defaults);
}

export async function testProviderConnection(provider: Pick<ProviderConfig, "apiBase" | "apiKey" | "config"> & { providerType?: string }, model: string) {
  const connection = normalizeProviderConnection(provider?.apiBase, provider?.apiKey);
  if (typeof model !== "string" || !model.trim()) throw new Error("请先选择或填写要测试的模型 ID。");
  // Enough output to observe incremental delivery. Use only this public sample,
  // never the clipboard. Exercise exactly the same settings and transport as translation.
  const sample = "A quiet library opened beside the river last spring. Every morning, volunteers arrange books and help visitors find something new to read. The large windows bring in natural light, and the small garden offers a peaceful place to rest.";
  const prompt = effectivePrompt(provider.config?.prompt).replace(/{from}/g, "English").replace(/{to}/g, "Simplified Chinese").replace(/{text}/g, sample);
  const result = await requestChatCompletion(axios, {
    ...connection, ...provider.config, providerType: provider.providerType, model: model.trim(),
    maxTokens: provider.config?.maxTokens ?? 4000, onProgress: () => {},
  }, [{ role: "user", content: prompt }]);
  return { ...result, model: model.trim(), text: result.text.trim().split(connection.apiKey).join("[已隐藏密钥]").slice(0, 2000) };
}
