import {
  BaseWindow,
  globalShortcut,
  Menu,
  MenuItem,
  KeyboardEvent,
  MenuItemConstructorOptions,
} from "electron";
import { roles, Role } from "../common/types";
import bus from "../common/event-bus";

import {
  Shortcuts,
  loadLocalShortcuts,
  loadGlobalShortcuts,
  resetFile,
} from "../common/shortcuts";
import { env } from "../common/env";
import { defaultSelectionShortcut, validSelectionShortcut, selectionShortcutIdentity } from "../common/selection-shortcut";

type Accelerator = string;
type CallBack = (
  key: string,
  menuItem?: MenuItem,
  browserWindow?: BaseWindow,
  event?: KeyboardEvent
) => void;

function defaultCallback(
  key: string,
  menuItem?: MenuItem,
  browserWindow?: BaseWindow,
  event?: KeyboardEvent
) {
  bus.at("dispatch", key);
}

class ShortcutManager {
  shortcuts: Shortcuts = new Map<string, Accelerator>();
  localShortcuts = new Map<string, Accelerator>();
  callback: CallBack;
  private recording = new Set<number>();

  constructor(callback: CallBack = defaultCallback) {
    this.callback = callback;
  }

  init() {
    this.shortcuts = loadGlobalShortcuts();
    this.register();
    this.localShortcuts = loadLocalShortcuts();
    this.registerLocalShortcuts();
  }

  register() {
    for (const [key, accelerator] of this.shortcuts) {
      if (!accelerator) continue;
      try {
        if (!globalShortcut.register(accelerator, () => this.callback(key))) console.warn("Shortcut registration failed:", key);
      } catch { console.warn("Invalid shortcut:", key); }
    }
  }

  unregister() {
    Array.from(this.shortcuts.values()).forEach((accelerator) => {
      if (accelerator) globalShortcut.unregister(accelerator);
    });
  }

  selectionStatus() {
    const shortcut = this.shortcuts.get("selectionTranslate") || "";
    return { shortcut, defaultShortcut: defaultSelectionShortcut,
      registered: !!shortcut && globalShortcut.isRegistered(shortcut), recording: this.recording.size > 0 };
  }

  recordSelection(owner: number, active: boolean) {
    const wasRecording = this.recording.size > 0;
    if (active) this.recording.add(owner); else this.recording.delete(owner);
    if (!wasRecording && this.recording.size) this.unregister();
    if (wasRecording && !this.recording.size) this.register();
    return this.selectionStatus();
  }

  setSelection(accelerator: unknown) {
    if (!validSelectionShortcut(accelerator)) return { ok: false, error: "invalid", ...this.selectionStatus() };
    const old = this.shortcuts.get("selectionTranslate") || "";
    const identity = selectionShortcutIdentity(accelerator);
    if ([...this.shortcuts].some(([key, value]) => key !== "selectionTranslate" && selectionShortcutIdentity(value) === identity)) {
      return { ok: false, error: "conflict", ...this.selectionStatus() };
    }
    // Register before dropping the old binding. A collision preserves the old key.
    const sameBinding = identity === selectionShortcutIdentity(old);
    const alreadyRegistered = sameBinding && globalShortcut.isRegistered(old);
    try {
      if (!alreadyRegistered && !globalShortcut.register(accelerator, () => this.callback("selectionTranslate"))) {
        return { ok: false, error: "conflict", ...this.selectionStatus() };
      }
    } catch { return { ok: false, error: "invalid", ...this.selectionStatus() }; }
    const updated = new Map(this.shortcuts).set("selectionTranslate", accelerator);
    try { resetFile(env.shortcut, updated); }
    catch {
      if (!alreadyRegistered) globalShortcut.unregister(accelerator);
      return { ok: false, error: "save", ...this.selectionStatus() };
    }
    if (old && !sameBinding) globalShortcut.unregister(old);
    this.shortcuts = updated;
    if (this.recording.size) globalShortcut.unregister(accelerator);
    return { ok: true, ...this.selectionStatus() };
  }

  getMenuItemOptions(key: string, accelerator: Accelerator) {
    const callback = this.callback;
    let options: MenuItemConstructorOptions = {
      accelerator,
      id: key,
      type: "normal",
      click: function (
        menuItem: MenuItem,
        browserWindow: BaseWindow | undefined,
        event: KeyboardEvent
      ) {
        callback(key, menuItem, browserWindow, event);
      },
    };
    if (roles.indexOf(key as Role) != -1) {
      options = {
        ...options,
        role: key as Role,
        click: undefined,
      };
    }
    return options;
  }

  registerLocalShortcuts() {
    const menu = new Menu();
    for (const [key, accelerator] of this.localShortcuts.entries()) {
      menu.append(new MenuItem(this.getMenuItemOptions(key, accelerator)));
    }
    Menu.setApplicationMenu(menu);
  }
}

export { ShortcutManager };
