import { macIntegration } from "./mac-integration";

async function key(name: "C" | "V") {
  if (process.platform === "darwin") { await macIntegration.request(name === "C" ? "copy" : "paste"); return; }
  const { uIOhook, UiohookKey } = require("uiohook-napi");
  uIOhook.keyTap(UiohookKey[name], [UiohookKey.Ctrl]);
}
export default { copy: () => key("C"), paste: () => key("V") };
