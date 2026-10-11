export const defaultSelectionShortcut = "CmdOrCtrl+Shift+X";

export function selectionShortcutIdentity(value: string, mac = process.platform === "darwin") {
  const parts = value.toUpperCase().split("+");
  const key = parts.pop();
  const modifiers = parts.map(part => {
    if (["CMDORCTRL", "COMMANDORCONTROL"].includes(part)) return mac ? "COMMAND" : "CONTROL";
    if (["CMD", "META"].includes(part) || mac && part === "SUPER") return "COMMAND";
    if (part === "CTRL") return "CONTROL";
    if (part === "OPTION") return "ALT";
    return part;
  }).sort();
  return [...modifiers, key].join("+");
}

export function formatSelectionShortcut(value: string, mac = process.platform === "darwin") {
  const parts = value.split("+").filter(Boolean).map(part => {
    if (/^(CmdOrCtrl|CommandOrControl)$/i.test(part)) return mac ? "⌘" : "Ctrl";
    if (/^(Cmd|Command|Meta)$/i.test(part)) return mac ? "⌘" : "Win";
    if (/^(Ctrl|Control)$/i.test(part)) return mac ? "⌃" : "Ctrl";
    if (/^Shift$/i.test(part)) return mac ? "⇧" : "Shift";
    if (/^(Alt|Option)$/i.test(part)) return mac ? "⌥" : "Alt";
    return part;
  });
  return parts.join(mac ? "" : "+");
}

export function selectionShortcutFromKey(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac = process.platform === "darwin") {
  const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, "")
    : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : "";
  if (!key) return "";
  const modifiers = [];
  if (event.metaKey) modifiers.push(mac ? "CmdOrCtrl" : "Super");
  if (event.ctrlKey) modifiers.push(mac ? "Control" : "CmdOrCtrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length || modifiers.every(value => value === "Shift")) return "";
  return [...modifiers, key].join("+");
}

export function validSelectionShortcut(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  const parts = value.split("+");
  const key = parts.pop() || "";
  return /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)
    && parts.length > 0 && parts.length <= 4 && new Set(parts).size === parts.length
    && parts.every(part => /^(CmdOrCtrl|CommandOrControl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super)$/.test(part))
    && parts.some(part => part !== "Shift");
}
