import { clipboard as nativeClipboard, nativeImage } from "electron";
import { EventEmitter } from "events";
import config from "@/common/configuration";
import { macIntegration } from "./mac-integration";

class ClipboardWatcher {
  private static events = new EventEmitter();
  private static watching = false;
  private static timer?: NodeJS.Timeout;
  private static initialized = false;
  private static paused = 0;
  private static checking = false;
  private static previousText = "";
  private static previousImage = "";

  static init() {
    if (this.initialized) return;
    this.initialized = true;
    macIntegration.on("clipboard", () => { if (this.watching) void this.check(); });
  }
  private static async check() {
    if (this.paused || this.checking || !this.watching) return;
    this.checking = true;
    try {
      const text = await nativeClipboard.readText();
      if (this.paused || !this.watching) return;
      const changed = text && text !== this.previousText;
      this.previousText = text;
      if (changed) this.events.emit("text-changed");
      // On macOS this runs only after the native change counter advances.
      // Never decode clipboard images when OCR is disabled.
      if (config.get("enableOCR") && await nativeClipboard.has("image/png")) {
        const image = await this.readImage();
        if (this.paused || !this.watching) return;
        if (!image.isEmpty()) {
          const hash = require("crypto").createHash("sha256").update(image.toPNG()).digest("hex");
          if (hash !== this.previousImage) { this.previousImage = hash; this.events.emit("image-changed"); }
        }
      } else this.previousImage = "";
    } catch (error) { console.warn("Clipboard read failed", error); }
    finally { this.checking = false; }
  }
  static async withPaused<T>(operation: () => Promise<T>): Promise<T> {
    this.paused++;
    try { return await operation(); }
    finally {
      try { this.previousText = await nativeClipboard.readText(); }
      finally { this.paused--; }
    }
  }
  static get isPaused() { return this.paused > 0; }
  static on(event: string, callback: (...args: any[]) => void) { this.events.on(event, callback); }
  static off(event: string) { this.events.removeAllListeners(event); }
  static readText(type?: "selection" | "clipboard") {
    return type === "selection" && process.platform === "linux" ? nativeClipboard.selection.readText() : nativeClipboard.readText();
  }
  static async readImage() {
    const items = await nativeClipboard.read();
    for (const item of items) {
      if (item.types.includes("image/png")) {
        const blob = await item.getType("image/png");
        return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      }
    }
    return nativeImage.createEmpty();
  }
  static async writeText(text: string) {
    return this.withPaused(async () => { await nativeClipboard.writeText(text); });
  }
  static async copySelection(text: string) {
    // Internal writes (for example copying a translation) stay silent. A drag
    // copy is user input and should reach the clipboard listener exactly once.
    const changed = text !== this.previousText;
    await this.writeText(text);
    if (changed && this.watching && !this.paused) this.events.emit("text-changed");
  }
  static async startWatching() {
    this.init();
    if (this.watching) return;
    this.watching = true;
    try { this.previousText = await nativeClipboard.readText(); } catch { /* Retry on next change. */ }
    if (!this.watching) return;
    if (process.platform === "darwin") macIntegration.configure({ clipboard: true });
    else this.timer = setInterval(() => { void this.check(); }, 750);
  }
  static stopWatching() {
    this.watching = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (process.platform === "darwin") macIntegration.configure({ clipboard: false });
  }
}
export const clipboard = ClipboardWatcher;
