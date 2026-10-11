import { Identifier } from "@/store";
import config from "../common/configuration";
import { macIntegration } from "./mac-integration";
import { windowsIntegration } from "./windows-integration";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
type BlackWhiteType = "listenClipboard" | "dragCopy";

export async function foregroundApplication(): Promise<{ pid: number; name: string; handle?: number }> {
  if (process.platform === "darwin") return macIntegration.request("frontmost");
  if (process.platform === "win32") return windowsIntegration.request("frontmost");
  // X11 only; Wayland intentionally restricts global selection access.
  const active = await execFileAsync("xprop", ["-root", "_NET_ACTIVE_WINDOW"], { timeout: 1000 });
  const handle = active.stdout.match(/0x[0-9a-f]+/i)?.[0];
  if (!handle || handle === "0x0") return { pid: 0, name: "" };
  const info = await execFileAsync("xprop", ["-id", handle, "_NET_WM_PID", "WM_CLASS"], { timeout: 1000 });
  const names = [...info.stdout.matchAll(/"([^"\n]+)"/g)];
  return { pid: Number(info.stdout.match(/_NET_WM_PID[^=]*=\s*(\d+)/)?.[1] || 0), name: names.pop()?.[1] || "" };
}

export async function isValidWindow(identifier: BlackWhiteType, application?: { name: string }): Promise<boolean> {
  const mode = config.get<string>(`${identifier}Mode` as Identifier);
  // No foreground lookup or native process launch is needed in global mode.
  if (mode.includes("Global") && !application) return true;
  try {
    const name = (application || await foregroundApplication()).name;
    if (!name) return false;
    const windows = new Set(config.get<string[]>("activeWindows"));
    if (!windows.has(name)) { windows.add(name); config.set("activeWindows", [...windows]); }
    if (mode.includes("Global")) return true;
    const list = config.get<string[]>(`${identifier}${mode.includes("WhiteList") ? "WhiteList" : "BlackList"}` as Identifier);
    return mode.includes("WhiteList") ? list.includes(name) : !list.includes(name);
  } catch (error) {
    console.warn("Cannot determine foreground application", error);
    return false;
  }
}
