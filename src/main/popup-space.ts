import { app, BrowserWindow } from "electron";
import { join } from "path";

declare const __non_webpack_require__: NodeRequire;

interface MacPopupSpace {
  prepare(handle: Buffer): void;
  settle(handle: Buffer): void;
  isOnActiveSpace(handle: Buffer): boolean;
}

let bridge: MacPopupSpace | undefined;
function macBridge(): MacPopupSpace {
  if (!bridge) {
    const binary = app.isPackaged
      ? join(process.resourcesPath, "native", "popup-space.node")
      : join(process.cwd(), "build", "native", process.arch, "popup-space.node");
    // Keep the native module outside webpack/asar, as a signed app resource.
    bridge = __non_webpack_require__(binary) as MacPopupSpace;
  }
  return bridge;
}

export function showPopupOnCurrentSpace(window: BrowserWindow) {
  if (process.platform !== "darwin") { window.showInactive(); return; }
  const native = macBridge();
  const handle = window.getNativeWindowHandle();
  native.prepare(handle);
  try { window.showInactive(); }
  finally { native.settle(handle); }
}

export function popupIsOnCurrentSpace(window: BrowserWindow) {
  return process.platform !== "darwin" || macBridge().isOnActiveSpace(window.getNativeWindowHandle());
}
