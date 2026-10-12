import * as http from "http";
import * as https from "https";

export function providerHTTPOptions(apiBase: string, apiKey: string, timeout: number, defaults?: any) {
  const host = new URL(apiBase).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.startsWith("192.168.") || host.startsWith("10.");
  return {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout,
    maxRedirects: 0,
    ...(defaults?.httpsAgent?.options?.rejectUnauthorized === false ? { httpsAgent: new https.Agent() } : {}),
    ...(local ? { httpAgent: new http.Agent(), httpsAgent: new https.Agent(), proxy: false as const } : {}),
  };
}

export function providerRequestError(error: any): string {
  const status = error?.response?.status;
  if (status === 401) return "密钥无效或已过期（401），请检查 API 密钥。";
  if (status === 403) return "没有访问权限（403），请检查账号及模型授权。";
  if (status === 404) return "接口或模型不存在（404）。请检查 API 地址；若服务不提供模型列表，可手动填写模型 ID 后测试。";
  if (status === 429) return "请求受限或额度不足（429），请检查余额及速率限制后重试。";
  if (status === 400 || status === 422) return "服务不接受当前模型或参数，请检查模型 ID、思考强度、温度及 Token 设置。";
  if (status >= 300 && status < 400) return "API 地址发生重定向，请填写服务商提供的最终 API 基础地址。";
  if (status >= 500) return `服务商暂时异常（${status}），请稍后重试。`;
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") return "请求超时，请检查网络、代理或稍后重试。";
  return "无法连接 API，请检查网络、代理、证书和 API 基础地址。";
}
