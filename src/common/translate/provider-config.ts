export function normalizeProviderConnection(apiBase: string, apiKey: string) {
  let url: URL;
  try { url = new URL(typeof apiBase === "string" ? apiBase.trim() : ""); }
  catch { throw new Error("请填写完整的 API 基础地址，例如 https://api.deepseek.com/v1"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("API 基础地址仅支持 HTTP/HTTPS，不应包含账号、查询参数或片段。");
  }
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) throw new Error("请先填写 API 密钥。");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "");
  return { apiBase: url.toString().replace(/\/+$/, ""), apiKey: key };
}

export function normalizeModelIds(models: unknown): string[] {
  return Array.isArray(models) ? [...new Set(models.filter((model): model is string => typeof model === "string").map(model => model.trim()).filter(Boolean))] : [];
}
