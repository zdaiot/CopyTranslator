import { customTranslatorManager } from "@/common/translate/custom-translators";
import { axios } from "@/common/translate/proxy";
import { buildContextChatMessages, ContextChatMessage } from "@/common/translate/context-chat";
import { requestChatCompletion } from "@/common/translate/chat-request";

export function selectionChatModels() {
  return customTranslatorManager.getAllIds().flatMap(id => {
    const model = customTranslatorManager.getConfig(id);
    return model && model.config.chatEnabled !== false ? [{ id, name: model.name, ai: true }] : [];
  });
}

export async function requestSelectionChat(engine: string, source: string, history: ContextChatMessage[], question: string,
  onProgress: (text: string) => void, signal: AbortSignal) {
  const model = customTranslatorManager.getConfig(engine);
  if (!model || model.config.chatEnabled === false) throw new Error("请在 AI 供应商配置中启用用于对话的模型。");
  const messages = buildContextChatMessages(source, history, question, model.config.chatPrompt);
  const response = await requestChatCompletion(axios, { ...model.config, onProgress, signal }, messages);
  return response.text;
}
