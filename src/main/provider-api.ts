import { ipcMain, WebContents } from "electron";
import { fetchModels } from "../common/translate/model-fetcher";
import { testProviderConnection } from "../common/translate/provider-connection";

export function registerProviderAPI(isSettingsWindow: (sender: WebContents) => boolean) {
  const requireSettings = (sender: WebContents) => {
    if (!isSettingsWindow(sender)) throw new Error("AI provider requests require the settings window");
  };
  ipcMain.handle("ai-provider:models", async (event, provider) => {
    requireSettings(event.sender);
    try { return { ok: true, models: await fetchModels(provider?.apiBase, provider?.apiKey) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "获取模型失败，请重试。" }; }
  });
  ipcMain.handle("ai-provider:test", async (event, provider, model) => {
    requireSettings(event.sender);
    try { return { ok: true, ...await testProviderConnection(provider, model) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "测试连接失败，请重试。" }; }
  });
}
