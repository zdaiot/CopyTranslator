import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import config from "@/common/configuration";
import { getTranslator, getEnabledWithCustomIds, hasTranslator, detectLang } from "@/common/translate/translators";
import { TranslatorNameResolver } from "@/common/translate/translator-name-resolver";
import { autoReSegment, normalizeAppend, appendSourceText } from "@/common/translate/helper";
import { Language } from "@/common/translate/types";
import { clipboard } from "./clipboard";
import { isPointInside, placeSelectionPopup, Point, SelectionRevision } from "./selection-utils";

interface PopupState {
  view: "button" | "translation";
  selectionId: number;
  text: string; translation: string; status: "idle" | "loading" | "done" | "error";
  error: string; engine: string; engines: { id: string; name: string; ai: boolean }[];
  pinned: boolean; from: string; to: string;
  incremental: boolean; accumulatedCount: number;
}

class SelectionPopup {
  private window?: BrowserWindow;
  private ready = false;
  private wantsVisible = false;
  private initialized = false;
  private revision = new SelectionRevision();
  private request?: AbortController;
  private destroyTimer?: NodeJS.Timeout;
  private buttonTimer?: NodeJS.Timeout;
  private anchor: Point = { x: 0, y: 0 };
  private accumulatedText = "";
  private lastAppend = "";
  private state: PopupState = { view: "translation", selectionId: 0, text: "", translation: "", status: "loading", error: "", engine: "", engines: [], pinned: false, from: "", to: "", incremental: false, accumulatedCount: 0 };

  init() {
    if (this.initialized) return;
    this.initialized = true;
    ipcMain.handle("selection-popup:state", (event) => {
      if (event.sender !== this.window?.webContents) return null;
      return this.state;
    });
    ipcMain.handle("selection-popup:action", async (event, action: string, value?: string) => {
      if (event.sender !== this.window?.webContents) return;
      if (action === "translate") {
        if (this.state.view === "button" && this.state.text && config.get("selectionPopup")) this.show(this.state.text, this.anchor);
        return;
      }
      if (this.state.view === "button" && action !== "close") return;
      switch (action) {
        case "close": this.hide(); break;
        case "pin": this.state.pinned = !this.state.pinned; this.publish(); break;
        case "incremental":
          if (config.set("incrementalCopy", !config.get("incrementalCopy"))) this.syncIncrementalMode(!!config.get("incrementalCopy"));
          break;
        case "clear-accumulated": this.clearAccumulated(); break;
        case "copy-source": await clipboard.writeText(this.state.text); break;
        case "copy-result": if (this.state.translation) await clipboard.writeText(this.state.translation); break;
        case "retry": void this.translate(); break;
        case "engine":
          if (this.state.engines.some((engine) => engine.id === value)) {
            this.state.engine = value!;
            void this.translate();
          }
          break;
        case "settings": global.controller.handle("settings", null); break;
        case "ai-settings": this.hide(); global.controller.handle("settings", "customTranslators"); break;
        case "main": global.controller.handle("showWindow", null); break;
      }
    });
  }

  syncIncrementalMode(enabled: boolean) {
    if (this.state.incremental === enabled) return;
    this.state.incremental = enabled;
    this.accumulatedText = "";
    this.lastAppend = "";
    this.state.accumulatedCount = 0;
    // Turning on while reading starts with this selection. Merely offering a
    // button must not collect text the user has not requested to translate.
    if (enabled && this.state.view === "translation" && this.state.text && this.state.text.length <= 20000) {
      this.accumulatedText = this.lastAppend = this.state.text;
      this.state.accumulatedCount = 1;
    }
    this.publish();
  }

  clearAccumulated() {
    this.revision.next();
    this.request?.abort();
    this.accumulatedText = this.lastAppend = "";
    this.state.accumulatedCount = 0;
    this.state.text = this.state.translation = this.state.error = "";
    this.state.from = this.state.to = "";
    this.state.status = "idle";
    this.publish();
  }

  private create() {
    const base = app.isPackaged ? app.getAppPath() : join(process.cwd(), "public");
    const window = new BrowserWindow({
      width: 450, height: 360, minWidth: 36, minHeight: 36,
      maxWidth: 900, maxHeight: 900, show: false, frame: false,
      transparent: true, hasShadow: true, roundedCorners: true,
      resizable: true, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, title: "划词翻译 · CopyTranslator",
      // A non-activating NSPanel can join another app's fullscreen Space while
      // the main app remains a regular Dock application. An NSWindow cannot.
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { preload: join(base, "selection-popup", "preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    this.window = window;
    this.ready = false;
    window.setAlwaysOnTop(true, "floating");
    if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape") { event.preventDefault(); this.hide(); }
    });
    window.on("blur", () => {
      // The selection button deliberately never takes focus. Dismiss it through
      // pointer/Escape/timeout events, not activation changes in the source app.
      if (this.state.view !== "button" && !this.state.pinned) this.hide();
    });
    window.on("closed", () => { this.window = undefined; this.ready = false; });
    window.once("ready-to-show", () => {
      this.ready = true;
      // It may have been dismissed while the renderer was loading.
      if (this.wantsVisible) { this.publish(); window.showInactive(); }
    });
    void window.loadFile(join(base, "selection-popup", "index.html"));
    return window;
  }

  contains(point: Point) {
    return !!this.window?.isVisible() && isPointInside(point, this.window.getBounds());
  }

  pointerDown(point: Point) {
    if (!this.state.pinned && !this.contains(point)) this.hide();
  }

  offer(text: string, point: Point) {
    const mode = config.get("selectionPopupTrigger");
    if (mode === "selectionShortcut") return;
    // A pinned result stays unchanged until another explicit translation.
    if (mode !== "selectionDirect" && this.state.pinned && this.window?.isVisible()) return;
    this.show(text, point, mode !== "selectionDirect");
  }

  show(text: string, point: Point, button = false) {
    if (!config.get("selectionPopup")) return;
    text = text.trim();
    if (!text) return;
    this.syncIncrementalMode(!!config.get("incrementalCopy"));
    text = config.get("autoPurify") ? normalizeAppend(text) : text;
    let limitError = false;
    if (!button && this.state.incremental) {
      // Repeat shortcuts, retry and engine changes must not duplicate a segment.
      if (text !== this.lastAppend && text !== this.accumulatedText) {
        const combined = appendSourceText(this.accumulatedText, text);
        if (combined.length > 20000) limitError = true;
        else {
          this.accumulatedText = combined;
          this.lastAppend = text;
          this.state.accumulatedCount++;
        }
      }
      text = this.accumulatedText;
    }
    this.revision.next();
    this.request?.abort();
    this.wantsVisible = true;
    if (this.buttonTimer) clearTimeout(this.buttonTimer);
    this.anchor = point;
    const previousView = this.state.view;
    this.state.selectionId += 1;
    this.state.view = button ? "button" : "translation";
    this.state.translation = "";
    this.state.error = limitError ? (this.state.accumulatedCount
      ? "累积原文最多 20,000 字符，本次选区未加入。请清空后开始新的累积。"
      : "选中文字超过 20,000 字符，本次未加入，请缩小选区。") : "";
    this.state.from = "";
    this.state.to = "";
    this.state.status = limitError ? "error" : "loading";
    this.init();
    if (this.destroyTimer) clearTimeout(this.destroyTimer);
    this.destroyTimer = undefined;
    const mainEngine = config.get<string>("translatorType");
    const engines = getEnabledWithCustomIds(config.get("translator-enabled"), config.get("customTranslators"));
    this.state.engines = [...new Set([mainEngine, ...engines])].filter(hasTranslator).map((id) => ({ id, name: TranslatorNameResolver.getDisplayName(id), ai: TranslatorNameResolver.isCustomTranslator(id) }));
    if (!this.state.engines.some((engine) => engine.id === this.state.engine)) {
      this.state.engine = this.state.engines.find(engine => engine.id === mainEngine)?.id || this.state.engines[0]?.id || "";
    }
    this.state.text = text;
    const window = this.window || this.create();
    window.setMinimumSize(button ? 36 : 340, button ? 36 : 220);
    window.setResizable(!button);
    window.setFocusable(!button);
    if (!this.state.pinned || !window.isVisible()) {
      const { width, height } = button ? { width: 40, height: 40 }
        : previousView === "button" ? { width: 450, height: 360 } : window.getBounds();
      window.setBounds(placeSelectionPopup(point, { width, height }, screen.getDisplayNearestPoint(point).workArea));
    }
    this.publish();
    if (this.ready) window.showInactive();
    if (button) {
      this.buttonTimer = setTimeout(() => this.hide(), 8000);
      this.buttonTimer.unref();
    } else if (!limitError) void this.translate();
  }

  private publish() {
    if (this.ready && this.window && !this.window.isDestroyed()) this.window.webContents.send("selection-popup:update", this.state);
  }

  private async translate() {
    const text = this.state.text;
    if (!text) return;
    const revision = this.revision.next();
    this.request?.abort();
    const request = this.request = new AbortController();
    this.state.status = "loading";
    this.state.translation = "";
    this.state.error = "";
    this.publish();
    try {
      if (text.length > 20000) throw new Error("选中的文字较长，请分段翻译（每次最多 20,000 字符）。");
      // Coalesce quick consecutive selections before starting network work.
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (!this.revision.current(revision)) return;
      const translator = getTranslator(this.state.engine);
      let from = config.get<Language>("sourceLanguage");
      let to = config.get<Language>("targetLanguage");
      if (config.get("smartTranslate")) {
        const detected = detectLang(text) as Language | undefined;
        if (detected) {
          if (detected === to) to = from === to ? (to === "en" ? "zh-CN" : "en") : from;
          from = detected;
        }
      }
      if (to === "auto") to = from === "zh-CN" ? "en" : "zh-CN";
      this.state.from = from;
      this.state.to = to;
      this.publish();
      const response = translator.translateStream
        ? await translator.translateStream(text, from, to, (translation) => {
          if (!this.revision.current(revision)) return;
          this.state.translation = translation;
          this.publish();
        }, request.signal)
        : await translator.translate(text, from, to);
      const result = autoReSegment(response);
      if (!this.revision.current(revision)) return;
      this.state.translation = result.resultString;
      if (!this.state.translation.trim()) throw new Error("翻译服务没有返回译文，请重试或更换引擎。");
      this.state.status = "done";
    } catch (error) {
      if (!this.revision.current(revision)) return;
      this.state.status = "error";
      this.state.error = error instanceof Error ? error.message : "翻译失败，请检查网络或翻译引擎配置。";
    }
    this.publish();
  }

  hide() {
    this.wantsVisible = false;
    this.revision.next();
    this.request?.abort();
    if (this.buttonTimer) clearTimeout(this.buttonTimer);
    this.buttonTimer = undefined;
    this.state.text = "";
    this.state.pinned = false;
    this.window?.hide();
    // Subsequent outside clicks must not postpone releasing a hidden renderer.
    if (this.window && !this.destroyTimer) {
      this.destroyTimer = setTimeout(() => {
        this.window?.destroy();
        this.destroyTimer = undefined;
      }, 30000);
      this.destroyTimer.unref();
    }
  }

  stop() {
    this.clearAccumulated();
    this.hide();
    if (this.destroyTimer) clearTimeout(this.destroyTimer);
    this.window?.destroy();
  }
}

export const selectionPopup = new SelectionPopup();
