type Accelerator = string;
import { env } from "./env";
import { mapToObj, objToMap } from "./types";
import fs from "fs";
import { version, compatible } from "./constant";
import { defaultSelectionShortcut } from "./selection-shortcut";
export interface Shortcut {
  accelerator: Accelerator;
  id: string;
}

export type Shortcuts = Map<string, Accelerator>;

export const defaultGlobalShortcuts: Shortcuts = new Map([
  ["focus", "Shift+F1"],
  ["selectionTranslate", defaultSelectionShortcut],
  ["contrast", "Shift+F2"],
  ["simulateCopy", "Super+`"],
  ["simulateIncrementCopy", "Super+Shift+`"],
]);

export const defaultLocalShortcuts: Shortcuts = new Map([
  ["undo", "CmdOrCtrl+Z"],
  ["redo", "Shift+CmdOrCtrl+Z"],
  ["cut", "CmdOrCtrl+X"],
  ["copy", "CmdOrCtrl+C"],
  ["paste", "CmdOrCtrl+V"],
  ["selectAll", "CmdOrCtrl+A"],
  ["copyResult", "CmdOrCtrl+S"],
  ["copySource", "CmdOrCtrl+D"],
  ["quit", "Cmd+Q"],
  ["hideWindow", "Escape"],
]);

export function resetFile(file: string, config: Map<string, Accelerator>) {
  const res = mapToObj(config);
  res["version"] = version;
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(res, null, 4), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}
export function resetGlobalShortcuts() {
  resetFile(env.shortcut, defaultGlobalShortcuts);
}

export function resetLocalShortcuts() {
  resetFile(env.localShortcut, defaultLocalShortcuts);
}

export function loadFile(
  file: string,
  defaultConfig: Map<string, Accelerator>
): Map<string, Accelerator> {
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!compatible(config.version)) {
      throw "config incompatible";
    } else {
      delete config.version;
      return objToMap(config);
    }
  } catch (e) {
    resetFile(file, defaultConfig);
    return defaultConfig;
  }
}

export function loadGlobalShortcuts(): Map<string, Accelerator> {
  const shortcuts = loadFile(env.shortcut, defaultGlobalShortcuts);
  // Migrate only this new action; retain every existing custom binding.
  // An empty accelerator is an intentional disabled binding.
  if (!shortcuts.has("selectionTranslate")) {
    shortcuts.set("selectionTranslate", defaultGlobalShortcuts.get("selectionTranslate")!);
    resetFile(env.shortcut, shortcuts);
  }
  return shortcuts;
}

export function loadLocalShortcuts(): Map<string, Accelerator> {
  return loadFile(env.localShortcut, defaultLocalShortcuts);
}
