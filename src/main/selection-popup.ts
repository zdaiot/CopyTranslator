import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import config from "@/common/configuration";
import { getTranslator, getEnabledWithCustomIds, hasTranslator, detectLang } from "@/common/translate/translators";
import { TranslatorNameResolver } from "@/common/translate/translator-name-resolver";
import { autoReSegment, normalizeAppend, appendSourceText } from "@/common/translate/helper";
import { Language } from "@/common/translate/types";
import { clipboard } from "./clipboard";
import { isPointInside, placeSelectionPopup, constrainPopupMove, resizeSelectionPopup, popupResizeEdges, PopupResizeEdge, popupSizes, PopupSizePreset, Bounds, Point, SelectionRevision } from "./selection-utils";
import { ContextChatMessage } from "@/common/translate/context-chat";
import { requestSelectionChat, selectionChatModels } from "./selection-chat";
import { showPopupOnCurrentSpace, popupIsOnCurrentSpace } from "./popup-space";

interface PopupState {
  view: "button" | "translation";
  selectionId: number;
  text: string; translation: string; status: "idle" | "loading" | "done" | "error";
  error: string; engine: string; engines: { id: string; name: string; ai: boolean }[];
  pinned: boolean; from: string; to: string;
  sizePreset: PopupSizePreset | "custom";
  incremental: boolean; accumulatedCount: number;
  pane: "translation" | "chat";
  chat: { engine: string; engines: { id: string; name: string; ai: boolean }[];
    messages: ContextChatMessage[]; status: "idle" | "loading" | "error"; error: string };
}

type PopupSizes = { translation: { width: number; height: number }; chat: { width: number; height: number } };

class PopupSession {
  window?: BrowserWindow;
  private ready = false;
  wantsVisible = false;
  private revision = new SelectionRevision();
  private request?: AbortController;
  private destroyTimer?: NodeJS.Timeout;
  private buttonTimer?: NodeJS.Timeout;
  private anchor: Point = { x: 0, y: 0 };
  private accumulatedText = "";
  private lastAppend = "";
  private drag?: { point: Point; bounds: Bounds };
  private resize?: { point: Point; bounds: Bounds; edge: PopupResizeEdge; workArea: Bounds };
  private chatRevision = new SelectionRevision();
  private chatRequest?: AbortController;
  state: PopupState = { view: "translation", selectionId: 0, text: "", translation: "", status: "loading", error: "", engine: "", engines: [], pinned: false, from: "", to: "", sizePreset: "small", incremental: false, accumulatedCount: 0,
    pane: "translation", chat: { engine: "", engines: [], messages: [], status: "idle", error: "" } };

  constructor(private owner: SelectionPopup, private sizes: PopupSizes, engine = "") {
    this.state.engine = engine;
  }

  async action(action: string, value?: unknown) {
    if (!this.wantsVisible) return;
    if (action === "translate") {
      if (this.state.view === "button" && this.state.text && config.get("selectionPopup")) this.show(this.state.text, this.anchor);
      return;
    }
    if (this.state.view === "button" && action !== "close") return;
    switch (action) {
      case "close": this.hide(); break;
      case "pin": this.owner.activate(this); this.state.pinned = !this.state.pinned; this.publish(); break;
      case "drag-start":
        if (this.window?.isVisible() && this.validPoint(value)) { this.resize = undefined; this.drag = { point: value, bounds: this.window.getBounds() }; }
        break;
      case "drag-move":
        if (this.drag && this.window?.isVisible() && this.validPoint(value)) {
          const bounds = { ...this.drag.bounds, x: this.drag.bounds.x + value.x - this.drag.point.x, y: this.drag.bounds.y + value.y - this.drag.point.y };
          this.window.setBounds(constrainPopupMove(bounds, screen.getDisplayNearestPoint(value).workArea));
        }
        break;
      case "drag-end": this.drag = undefined; break;
      case "resize-start": {
        const input = value as Point & { edge: PopupResizeEdge };
        if (this.window?.isVisible() && this.validPoint(input) && popupResizeEdges.includes(input.edge)) {
          const bounds = this.window.getBounds();
          this.drag = undefined;
          this.resize = { point: input, bounds, edge: input.edge, workArea: screen.getDisplayMatching(bounds).workArea };
        }
        break;
      }
      case "resize-move":
        if (this.resize && this.window?.isVisible() && this.validPoint(value)) {
          const { point, bounds, edge, workArea } = this.resize;
          this.window.setBounds(resizeSelectionPopup(bounds, edge, { x: value.x - point.x, y: value.y - point.y }, workArea, this.minimumSize()));
          this.rememberSize(); this.publish();
        }
        break;
      case "resize-end": this.resize = undefined; break;
      case "size-preset":
        if (typeof value === "string" && Object.prototype.hasOwnProperty.call(popupSizes, value)) this.setSizePreset(value as PopupSizePreset);
        break;
      case "pane": if (value === "translation" || value === "chat") this.switchPane(value); break;
      case "chat-send": if (typeof value === "string") void this.ask(value); break;
      case "chat-stop": this.cancelChat(); this.publish(); break;
      case "chat-clear": this.resetChat(); this.publish(); break;
      case "chat-retry": {
        const messages = this.state.chat.messages;
        const last = messages[messages.length - 1];
        const user = messages[messages.length - 2];
        if (this.state.chat.status !== "loading" && last?.role === "assistant" && last.status !== "done" && user?.role === "user") {
          messages.splice(-2); void this.ask(user.content);
        }
        break;
      }
      case "chat-engine":
        this.refreshChatModels();
        if (typeof value === "string" && this.state.chat.engines.some(engine => engine.id === value) && value !== this.state.chat.engine) {
          this.resetChat(); this.state.chat.engine = value; this.publish();
        }
        this.publish();
        break;
      case "incremental":
        if (config.set("incrementalCopy", !config.get("incrementalCopy"))) this.owner.syncIncrementalMode(!!config.get("incrementalCopy"));
        break;
      case "clear-accumulated": this.clearAccumulated(); break;
      case "copy-source": await clipboard.writeText(this.state.text); break;
      case "copy-result": if (this.state.translation) await clipboard.writeText(this.state.translation); break;
      case "retry": void this.translate(); break;
      case "engine":
        if (typeof value === "string" && this.state.engines.some((engine) => engine.id === value)) {
          this.state.engine = value;
          void this.translate();
        }
        break;
      case "settings": global.controller.handle("settings", null); break;
      case "ai-settings": this.hide(); global.controller.handle("settings", "customTranslators"); break;
      case "main": global.controller.handle("showWindow", null); break;
    }
  }

  private validPoint(value: unknown): value is Point {
    const point = value as Point;
    return !!point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 100000 && Math.abs(point.y) < 100000;
  }

  private minimumSize() { return { width: 340, height: this.state.pane === "chat" ? 360 : 260 }; }

  private presetSize(preset: PopupSizePreset, workArea: Bounds) {
    const size = popupSizes[preset];
    return { width: Math.min(size.width, workArea.width), height: Math.min(this.state.pane === "chat" ? size.chatHeight : size.height, workArea.height) };
  }

  private rememberSize() {
    if (!this.window || this.state.view === "button") return;
    const bounds = this.window.getBounds();
    this.sizes[this.state.pane] = { width: bounds.width, height: bounds.height };
    this.owner.rememberSize(this.state.pane, this.sizes[this.state.pane]);
    const area = screen.getDisplayMatching(bounds).workArea;
    this.state.sizePreset = (Object.keys(popupSizes) as PopupSizePreset[]).find(preset => {
      const size = this.presetSize(preset, area);
      return size.width === bounds.width && size.height === bounds.height;
    }) || "custom";
  }

  private applySize(size: { width: number; height: number }) {
    if (!this.window) return;
    const bounds = this.window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    this.window.setBounds(constrainPopupMove({ ...bounds, width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) }, area));
    this.rememberSize();
  }

  private setSizePreset(preset: PopupSizePreset) {
    if (!this.window?.isVisible()) return;
    this.drag = undefined; this.resize = undefined;
    this.applySize(this.presetSize(preset, screen.getDisplayMatching(this.window.getBounds()).workArea));
    this.publish();
  }

  private refreshChatModels() {
    this.state.chat.engines = selectionChatModels();
    if (!this.state.chat.engines.some(engine => engine.id === this.state.chat.engine)) {
      this.resetChat();
      this.state.chat.engine = this.state.chat.engines.find(engine => engine.id === this.state.engine)?.id || this.state.chat.engines[0]?.id || "";
    }
  }

  private switchPane(pane: "translation" | "chat") {
    if (pane === this.state.pane || !this.window?.isVisible()) return;
    this.rememberSize();
    this.state.pane = pane;
    if (pane === "chat") this.refreshChatModels();
    const minimum = this.minimumSize();
    this.window.setMinimumSize(minimum.width, minimum.height);
    this.applySize(this.sizes[pane]);
    this.publish();
  }

  private cancelChat() {
    this.chatRevision.next();
    this.chatRequest?.abort();
    this.chatRequest = undefined;
    const last = this.state.chat.messages[this.state.chat.messages.length - 1];
    if (last?.status === "loading") last.status = "stopped";
    this.state.chat.status = "idle";
  }

  private resetChat() {
    this.cancelChat();
    this.state.chat.messages = [];
    this.state.chat.error = "";
  }

  private async ask(question: string) {
    const chat = this.state.chat;
    if (this.state.pane !== "chat" || !this.wantsVisible || chat.status === "loading") return;
    this.refreshChatModels();
    question = question.trim();
    if (!this.state.text || !question || question.length > 4000 || !chat.engine || chat.messages.length >= 40) {
      chat.error = !chat.engine ? "请先在 AI 供应商配置中启用对话模型。" : chat.messages.length >= 40 ? "请点击“新对话”后继续。" : "请选择原文，每次提问请填写 1–4,000 个字符。";
      chat.status = "error"; this.publish(); return;
    }
    const revision = this.chatRevision.next();
    const request = this.chatRequest = new AbortController();
    const history = chat.messages.slice();
    const assistant: ContextChatMessage = { role: "assistant", content: "", status: "loading" };
    chat.messages.push({ role: "user", content: question, status: "done" }, assistant);
    chat.status = "loading"; chat.error = ""; this.publish();
    try {
      const answer = await requestSelectionChat(chat.engine, this.state.text, history, question, text => {
        if (!this.chatRevision.current(revision)) return;
        assistant.content = text; this.publish();
      }, request.signal);
      if (!this.chatRevision.current(revision)) return;
      assistant.content = answer; assistant.status = "done"; chat.status = "idle";
    } catch (error) {
      if (!this.chatRevision.current(revision)) return;
      assistant.status = "error"; chat.status = "error";
      chat.error = error instanceof Error ? error.message : "对话失败，请重试。";
    }
    if (this.chatRevision.current(revision)) { this.chatRequest = undefined; this.publish(); }
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
    this.resetChat();
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
      // Transparent panels do not support reliable native edge resizing.
      // Eight renderer handles resize explicitly through validated IPC.
      resizable: false, movable: true, minimizable: false, maximizable: false,
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
    // Claim this Space before the renderer loads, without showing a blank frame.
    // ready-to-show only reveals it; it must not move it to a different Space.
    window.setOpacity(0);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape") { event.preventDefault(); this.hide(); }
    });
    // Blur also occurs during Spaces / Mission Control. It is not a dismissal.
    window.on("focus", () => this.owner.activate(this));
    window.on("closed", () => {
      this.window = undefined; this.ready = false;
      if (this.wantsVisible) this.hide();
      this.owner.release(this);
    });
    window.once("ready-to-show", () => {
      this.ready = true;
      if (this.wantsVisible) { this.publish(); window.setOpacity(1); }
    });
    void window.loadFile(join(base, "selection-popup", "index.html"));
    return window;
  }

  onCurrentSpace() {
    return !!this.window && !this.window.isDestroyed() && popupIsOnCurrentSpace(this.window);
  }

  contains(point: Point) {
    return this.wantsVisible && this.onCurrentSpace() && isPointInside(point, this.window!.getBounds());
  }

  pointerDown(point: Point) {
    if (!this.state.pinned && this.wantsVisible && this.onCurrentSpace() && !this.contains(point)) this.hide();
  }

  workspaceChanged() {
    this.drag = undefined; this.resize = undefined;
    // Only the transient selection button expires. Results remain in their Space.
    if (this.state.view === "button") this.hide();
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
    this.resetChat();
    if (this.state.pane === "chat") this.switchPane("translation");
    this.state.pane = "translation";
    this.wantsVisible = true;
    if (this.buttonTimer) clearTimeout(this.buttonTimer);
    this.anchor = point;
    this.state.selectionId += 1;
    this.state.view = button ? "button" : "translation";
    this.state.translation = "";
    this.state.error = limitError ? (this.state.accumulatedCount
      ? "累积原文最多 20,000 字符，本次选区未加入。请清空后开始新的累积。"
      : "选中文字超过 20,000 字符，本次未加入，请缩小选区。") : "";
    this.state.from = "";
    this.state.to = "";
    this.state.status = limitError ? "error" : "loading";
    if (this.destroyTimer) clearTimeout(this.destroyTimer);
    this.destroyTimer = undefined;
    const mainEngine = config.get<string>("translatorType");
    const engines = getEnabledWithCustomIds(config.get("translator-enabled"), config.get("customTranslators"));
    this.state.engines = [...new Set([mainEngine, ...engines])].filter(hasTranslator).map((id) => ({ id, name: TranslatorNameResolver.getDisplayName(id), ai: TranslatorNameResolver.isCustomTranslator(id) }));
    if (!this.state.engines.some((engine) => engine.id === this.state.engine)) {
      this.state.engine = this.state.engines.find(engine => engine.id === mainEngine)?.id || this.state.engines[0]?.id || "";
    }
    this.state.text = text;
    this.refreshChatModels();
    const window = this.window || this.create();
    window.setMinimumSize(button ? 36 : 340, button ? 36 : 260);
    window.setFocusable(!button);
    if (!this.state.pinned || !window.isVisible()) {
      const { width, height } = button ? { width: 40, height: 40 }
        : this.sizes.translation;
      window.setBounds(this.owner.place(this, point, { width, height }));
    }
    this.rememberSize();
    this.publish();
    showPopupOnCurrentSpace(window);
    if (this.ready) window.setOpacity(1);
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
    this.drag = undefined;
    this.resize = undefined;
    this.resetChat();
    if (this.state.pane === "chat") this.switchPane("translation");
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

class SelectionPopup {
  private initialized = false;
  private sessions: PopupSession[] = [];
  private current?: PopupSession;
  private sizes: PopupSizes = { translation: { width: 450, height: 360 }, chat: { width: 450, height: 500 } };

  init() {
    if (this.initialized) return;
    this.initialized = true;
    ipcMain.handle("selection-popup:state", event => this.sessions.find(session => session.window?.webContents === event.sender)?.state || null);
    ipcMain.handle("selection-popup:action", (event, action: string, value?: unknown) => {
      const session = this.sessions.find(candidate => candidate.window?.webContents === event.sender);
      return session?.action(action, value);
    });
  }

  rememberSize(pane: "translation" | "chat", size: { width: number; height: number }) {
    this.sizes[pane] = { ...size };
  }

  activate(session: PopupSession) { this.current = session; }

  release(session: PopupSession) {
    // Keep the latest reading session's accumulated source after renderer cleanup.
    if (session !== this.current) this.sessions = this.sessions.filter(candidate => candidate !== session);
  }

  place(session: PopupSession, point: Point, size: { width: number; height: number }) {
    const area = screen.getDisplayNearestPoint(point).workArea;
    const initial = placeSelectionPopup(point, size, area);
    const others = this.sessions.filter(candidate => candidate !== session && candidate.wantsVisible && candidate.onCurrentSpace()).map(candidate => candidate.window!.getBounds());
    const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    if (!others.some(bounds => overlaps(initial, bounds))) return initial;
    // Prefer side by side; on crowded displays leave both titlebars reachable.
    for (const bounds of others.slice().reverse()) {
      for (const position of [{ x: bounds.x + bounds.width + 12, y: bounds.y }, { x: bounds.x - initial.width - 12, y: bounds.y }, { x: bounds.x, y: bounds.y + bounds.height + 12 }]) {
        const candidate = { ...initial, ...position };
        if (candidate.x >= area.x && candidate.y >= area.y && candidate.x + candidate.width <= area.x + area.width && candidate.y + candidate.height <= area.y + area.height && !others.some(other => overlaps(candidate, other))) return candidate;
      }
    }
    const last = others[others.length - 1];
    return constrainPopupMove({ ...initial, x: last.x + 28, y: last.y + 28 }, area);
  }

  show(text: string, point: Point, button = false) {
    if (!config.get("selectionPopup") || !text.trim()) return;
    this.init();
    // Pinned snapshots and results in other Spaces must never be overwritten.
    const latest = this.current && (!this.current.wantsVisible || this.current.onCurrentSpace()) ? this.current
      : this.sessions.slice().reverse().find(candidate => candidate.wantsVisible && candidate.onCurrentSpace());
    let session = latest && !latest.state.pinned ? latest : undefined;
    if (!session) {
      session = new PopupSession(this, { translation: { ...this.sizes.translation }, chat: { ...this.sizes.chat } }, this.current?.state.engine);
      this.sessions.push(session);
    }
    this.current = session;
    this.sessions = this.sessions.filter(candidate => candidate === session || candidate.window || candidate.wantsVisible);
    session.show(text, point, button);
  }

  offer(text: string, point: Point) {
    const mode = config.get("selectionPopupTrigger");
    if (mode !== "selectionShortcut") this.show(text, point, mode !== "selectionDirect");
  }

  contains(point: Point) { return this.sessions.some(session => session.contains(point)); }
  pointerDown(point: Point) {
    // Interacting with any comparison window should not dismiss its neighbours.
    if (!this.contains(point)) this.sessions.forEach(session => session.pointerDown(point));
  }
  workspaceChanged() { this.sessions.forEach(session => session.workspaceChanged()); }
  syncIncrementalMode(enabled: boolean) { this.sessions.forEach(session => session.syncIncrementalMode(enabled)); }
  clearAccumulated() { this.sessions.forEach(session => session.clearAccumulated()); }
  hide() { this.sessions.forEach(session => session.hide()); }
  dismiss() {
    const focused = BrowserWindow.getFocusedWindow();
    const session = this.sessions.find(candidate => candidate.wantsVisible && candidate.window === focused && candidate.onCurrentSpace())
      || this.sessions.slice().reverse().find(candidate => candidate.wantsVisible && candidate.onCurrentSpace());
    session?.hide();
  }
  stop() { this.sessions.slice().forEach(session => session.stop()); this.sessions = []; this.current = undefined; }
}

export const selectionPopup = new SelectionPopup();
