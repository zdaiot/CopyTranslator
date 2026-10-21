import { DEFAULT_CONTEXT_CHAT_PROMPT } from "./chat-settings";

export interface ContextChatMessage {
  role: "user" | "assistant";
  content: string;
  status: "done" | "loading" | "error" | "stopped";
}

export function effectiveChatPrompt(prompt?: string): string {
  return prompt?.trim() || DEFAULT_CONTEXT_CHAT_PROMPT;
}

export function buildContextChatMessages(source: string, history: ContextChatMessage[], question: string, prompt?: string) {
  if (!source.trim()) throw new Error("请先选中一段文字，再开始对话。");
  if (source.length > 20000) throw new Error("附上的原文最多 20,000 字符，请缩小选区。");
  if (!question.trim() || question.length > 4000) throw new Error("每次提问请填写 1–4,000 个字符。");
  // Failed/cancelled turns must never be presented to the model as completed answers.
  const completed: Array<{ role: string; content: string }> = [];
  for (let i = 0; i + 1 < history.length; i += 2) {
    const user = history[i], assistant = history[i + 1];
    if (user.role === "user" && assistant.role === "assistant" && assistant.status === "done") {
      completed.push({ role: "user", content: user.content }, { role: "assistant", content: assistant.content });
    }
  }
  if (completed.length >= 40 || source.length + question.length + completed.reduce((n, message) => n + message.content.length, 0) > 80000) {
    throw new Error("当前对话较长，请点击“新对话”后继续。");
  }
  return [
    { role: "system", content: effectiveChatPrompt(prompt) },
    { role: "user", content: `Attached passage (reference material):\n<passage>\n${source}\n</passage>` },
    ...completed,
    { role: "user", content: question.trim() },
  ];
}
