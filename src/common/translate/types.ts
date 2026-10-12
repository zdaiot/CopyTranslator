import type { ChatSettings } from "./chat-settings";
import {
  TranslateResult,
  Language,
  Translator as BaseTranslator,
  Languages,
  TranslateQueryResult,
  TranslateError,
} from "@opentranslate2/translator";
import { ColorStatus } from "../types";
import { TranslatorType } from "../types";
export { TranslateResult, Language, Languages, BaseTranslator, TranslateQueryResult, TranslateError };
export * from "./result-types";

export type CopyTranslateResult = TranslateResult & {
  resultString: string;
};

export interface Translator {
  name: string; // 翻译器名称
  config?: any; // 具体翻译器的配置项

  translate(
    text: string,
    from: Language,
    to: Language,
    config?: any
  ): Promise<TranslateResult>;
  translateStream?(
    text: string, from: Language, to: Language,
    onProgress: (text: string) => void, signal?: AbortSignal
  ): Promise<TranslateResult>;
  detect(text: string): Promise<Language>;
  getSupportLanguages(): Language[];
}

export abstract class DirectionalTranslator<
  Config extends {}
> extends BaseTranslator<Config> {
  getSupportLanguages(): Languages {
    throw "This method should not be used for DirectionalTranslator.";
  }
  abstract getSupportSourceLanguages(): Language[];
  abstract getSupportTargetLanguages(): Language[];
  abstract isSupport(from: Language, to: Language): boolean;
}

export const promiseAny = async <T>(
  iterable: Iterable<T | PromiseLike<T>>
): Promise<T> => {
  return Promise.all(
    [...iterable].map((promise) => {
      return new Promise((resolve, reject) =>
        Promise.resolve(promise).then(reject, resolve)
      );
    })
  ).then(
    (errors) => Promise.reject(errors),
    (value) => Promise.resolve<T>(value)
  );
};

// OpenAI 兼容 API 的配置接口
export interface OpenAIConfig extends ChatSettings {
  providerType?: string;
  apiBase: string; // API 基础地址，例如: https://api.openai.com/v1
  apiKey: string; // API 密钥
  model?: string; // 模型名称，默认为 gpt-3.5-turbo
  translatorName?: string; // 翻译器名称
  onProgress?: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * 供应商配置接口
 * 一个供应商可以提供多个翻译模型
 */
export interface ProviderConfig {
  id: string; // 供应商唯一标识符，如 "openai-official", "deepseek-main"
  name: string; // 显示名称，如 "OpenAI Official", "DeepSeek API"
  providerType: string; // 供应商类型：openai/deepseek/moonshot/zhipu/dashscope/custom
  apiBase: string; // API 基础地址
  apiKey: string; // API 密钥
  enabledModels: string[]; // 已启用的模型列表，如 ["gpt-4", "gpt-3.5-turbo"]
  availableModels?: string[]; // 已获取或手动添加的候选模型；保存列表不代表启用
  config?: ChatSettings; // 应用于该供应商全部已启用的模型
  enabled?: boolean; // 是否启用该供应商（默认true）
}

/**
 * 预定义供应商模板
 * 用于快速配置常见的 API 供应商
 */
export interface ProviderTemplate {
  type: string; // 供应商类型标识，如 "openai", "deepseek"
  name: string; // 默认显示名称
  apiBase: string; // 默认 API Base URL
  recommendedModels: string[]; // 推荐模型列表（作为获取失败时的后备）
  icon?: string; // 图标名称（mdi-icon）
  image?: string; // 图片文件名（用于 EngineButton 显示）
  docUrl?: string; // 文档链接
  description?: string; // 供应商描述
}

// 目前只支持 OpenAI 兼容 API 的自定义翻译器配置
export type CustomTranslatorConfig = {
  id: string;
  name: string;
  providerId: string; // 关联到供应商 ID
  config: OpenAIConfig;
};
