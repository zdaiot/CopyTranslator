/**
 * 模型列表获取工具
 * 用于从 OpenAI 兼容的 API 获取可用模型列表
 */

import { axios } from "./proxy";
import { normalizeProviderConnection, providerRequestOptions, providerRequestError } from "./provider-connection";

export interface ModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

/**
 * 从 OpenAI 兼容的 API 获取模型列表
 * @param apiBase API 基础地址（如：https://api.openai.com/v1）
 * @param apiKey API 密钥
 * @returns 模型 ID 列表
 */
export async function fetchModels(
  apiBase: string,
  apiKey: string
): Promise<string[]> {
  const connection = normalizeProviderConnection(apiBase, apiKey);
  let response: any;
  try {
    response = await axios.get(`${connection.apiBase}/models`, providerRequestOptions(connection.apiBase, connection.apiKey, 10000));
  } catch (error) { throw new Error(providerRequestError(error)); }
  if (!Array.isArray(response.data?.data)) throw new Error("服务未返回可用的模型列表，请手动填写模型 ID 后测试。");
  return [...new Set<string>(response.data.data
    .map((model: ModelInfo) => typeof model?.id === "string" ? model.id.trim() : "")
    .filter((id: string) => !!id))].sort();
}

/**
 * 获取推荐的模型列表（作为后备）
 */
export function getRecommendedModels(provider: string): string[] {
  const modelMap: Record<string, string[]> = {
    openai: [
      "gpt-4-turbo-preview",
      "gpt-4",
      "gpt-4-32k",
      "gpt-3.5-turbo",
      "gpt-3.5-turbo-16k",
    ],
    azure: ["gpt-4", "gpt-35-turbo"],
    deepseek: ["deepseek-chat", "deepseek-coder"],
    moonshot: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    zhipu: ["glm-4", "glm-3-turbo"],
    dashscope: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext"],
  };

  return modelMap[provider] || [];
}

/**
 * 验证 API 配置
 */
export async function validateAPIConfig(
  apiBase: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string; models?: string[] }> {
  try {
    const models = await fetchModels(apiBase, apiKey);
    return {
      valid: true,
      models,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || "验证失败",
    };
  }
}
