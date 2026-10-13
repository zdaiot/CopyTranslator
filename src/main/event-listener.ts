import { BrowserWindow, screen, systemPreferences } from "electron";
import { clipboard } from "./clipboard";
import eventBus from "../common/event-bus";
import config from "../common/configuration";
import { foregroundApplication, isValidWindow } from "./focus-handler";
import { macIntegration } from "./mac-integration";
import { windowsIntegration } from "./windows-integration";
import { selectionPopup } from "./selection-popup";
import { isPointInside, Point, SelectionRevision } from "./selection-utils";

class EventListener {
  private bound = false;
  private hook?: typeof import("uiohook-napi").uIOhook;
  private running = false;
  private revision = new SelectionRevision();
  private lastCopy = 0;
  private copying = false;
  private queued?: { point: Point; application?: { pid: number; name: string; handle?: number }; revision: number; explicit: boolean; doubleClick: boolean };
  private down?: { point: Point; time: number };
  private permission?: boolean;
  private lastCapture = "none";

  bind() {
    if (this.bound) return;
    this.bound = true;
    selectionPopup.init();
    if (process.env.COPYTRANSLATOR_DISABLE_GLOBAL_HOOKS === "1") return;
    if (process.platform === "darwin") {
      macIntegration.on("status", (state) => {
        if (this.permission !== state.accessibility) {
          this.permission = state.accessibility;
          console.info("Selection Accessibility permission:", state.accessibility ? "granted" : "missing");
        }
      });
      macIntegration.on("pointerdown", (point) => this.pointerDown(point));
      macIntegration.on("selection-gesture", (event) => { void this.gesture(event, event.application, false, !!event.doubleClick); });
      macIntegration.on("escape", () => this.dismiss());
      macIntegration.on("double-copy", () => this.doubleCopy());
    } else {
      try {
        this.hook = require("uiohook-napi").uIOhook;
        this.hook!.on("mousedown", (event) => {
          if (event.button !== 1) return;
          const point = this.point(event);
          this.pointerDown(point);
          this.down = { point, time: Date.now() };
        });
        this.hook!.on("mouseup", (event) => {
          if (event.button !== 1) return;
          const point = this.point(event);
          const dragged = this.down && Date.now() - this.down.time >= 100 && Math.hypot(point.x - this.down.point.x, point.y - this.down.point.y) >= 8;
          this.down = undefined;
          if (dragged || event.clicks >= 2) void this.gesture(point, undefined, false, !dragged);
        });
        this.hook!.on("keydown", (event) => {
          if (event.keycode === 1) this.dismiss();
          if (this.copying) return;
          if (event.keycode === 46 && event.ctrlKey) {
            const now = Date.now();
            if (now - this.lastCopy < 800) this.doubleCopy();
            this.lastCopy = now;
          }
        });
      } catch (error) { console.warn("Global selection hook unavailable", error); }
    }
    this.refresh();
  }
  private point(point: Point): Point {
    return process.platform === "win32" ? screen.screenToDipPoint(point) : { x: point.x, y: point.y };
  }
  private ownWindow(point: Point) {
    const focused = BrowserWindow.getFocusedWindow();
    return selectionPopup.contains(point) || !!focused && focused.isVisible() && isPointInside(point, focused.getBounds());
  }
  private pointerDown(point: Point) { this.revision.next(); selectionPopup.pointerDown(point); }
  private dismiss() { this.revision.next(); selectionPopup.hide(); }
  private doubleCopy() {
    if (config.get("enableDoubleCopyTranslate")) setTimeout(() => eventBus.at("dispatch", "doubleCopyTranslate"), 100);
  }
  async translateSelection() {
    if (!config.get("selectionPopup")) return;
    await this.gesture(screen.getCursorScreenPoint(), undefined, true);
  }
  private async gesture(point: Point, application?: { pid: number; name: string; handle?: number }, explicit = false, doubleClick = false) {
    const copySelection = !explicit && !!config.get("dragCopy") && (!doubleClick || !!config.get("doubleClickCopy"));
    const offerPopup = !!config.get("selectionPopup") && (explicit || config.get("selectionPopupTrigger") !== "selectionShortcut");
    if ((!copySelection && !offerPopup) || (!explicit && this.ownWindow(point))) return;
    const revision = this.revision.next();
    if (this.copying) { this.queued = { point, application, revision, explicit, doubleClick }; return; }
    let ownsCapture = false;
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (!this.revision.current(revision)) return;
      application = application || await foregroundApplication();
      if (application.pid === process.pid || !application.pid || !await isValidWindow("dragCopy", application) || !this.revision.current(revision)) return;
      this.copying = true;
      ownsCapture = true;
      const text = await clipboard.withPaused(async () => {
        if (process.platform === "darwin" || process.platform === "win32") {
          const result = process.platform === "darwin"
            ? await macIntegration.request("capture", { pid: application!.pid })
            : await windowsIntegration.request("capture", { handle: application!.handle });
          this.lastCapture = result.reason || result.method || "no-selection";
          return result.text;
        }
        return clipboard.readText("selection");
      });
      if (!this.revision.current(revision) || typeof text !== "string" || !text.trim()) return;
      // Both features share one capture. Drag Copy keeps the selected text in
      // the clipboard; the popup alone still restores the previous clipboard.
      if (copySelection && config.get("dragCopy") && (!doubleClick || config.get("doubleClickCopy"))) await clipboard.copySelection(text);
      if (this.revision.current(revision) && offerPopup && config.get("selectionPopup")) {
        if (explicit) selectionPopup.show(text, point);
        else selectionPopup.offer(text, point);
      }
    } catch (error) { console.warn("Selection capture unavailable", error); }
    finally {
      if (ownsCapture) {
        this.copying = false;
        const queued = this.queued;
        this.queued = undefined;
        if (queued && this.revision.current(queued.revision)) void this.gesture(queued.point, queued.application, queued.explicit, queued.doubleClick);
      }
    }
  }
  async status() {
    const enabled = !!config.get("selectionPopup");
    if (process.platform !== "darwin") return { enabled };
    const mainAccessibility = systemPreferences.isTrustedAccessibilityClient(false);
    if (!enabled && !config.get("dragCopy") && !config.get("enableDoubleCopyTranslate")) {
      return { enabled, accessibility: mainAccessibility, lastCapture: this.lastCapture };
    }
    try {
      const state = await macIntegration.request("status");
      return { ...state, enabled, mainAccessibility, lastCapture: this.lastCapture === "none" ? state.lastCapture : this.lastCapture };
    } catch {
      return { enabled, accessibility: mainAccessibility, error: "helper-unavailable" };
    }
  }
  refresh() {
    if (!this.bound || process.env.COPYTRANSLATOR_DISABLE_GLOBAL_HOOKS === "1") return;
    this.revision.next();
    const selection = !!config.get("selectionPopup") || !!config.get("dragCopy");
    const doubleCopy = !!config.get("enableDoubleCopyTranslate");
    selectionPopup.hide();
    if (process.platform === "darwin") macIntegration.configure({ selection, doubleCopy });
    else if (this.hook) {
      const needed = selection || doubleCopy;
      if (needed !== this.running) {
        try { if (needed) this.hook.start(); else this.hook.stop(); this.running = needed; }
        catch (error) { console.warn("Cannot start global selection hook", error); }
      }
    }
  }
  stop() { this.dismiss(); if (this.running) this.hook?.stop(); this.running = false; windowsIntegration.stop(); }
}
export const eventListener = new EventListener();
