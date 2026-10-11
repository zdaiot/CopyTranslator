import AppKit
import ApplicationServices

// A single event-driven helper. The clipboard timer reads only changeCount;
// it never reads or encodes an unchanged image.
final class SelectionHelper {
    let pasteboard = NSPasteboard.general
    let ownerPID = pid_t(CommandLine.arguments.dropFirst().first.flatMap(Int32.init) ?? getppid())
    var clipboardTimer: Timer?
    var mouseMonitor: Any?
    var keyboardMonitor: Any?
    var workspaceObservers: [NSObjectProtocol] = []
    var trusted: Bool?
    var gestures = 0
    var captures = 0
    var lastCapture = "none"
    var previousChange = NSPasteboard.general.changeCount
    var watchSelection = false
    var doubleCopy = false
    var downPoint: CGPoint?
    var downTime = Date.distantPast
    var lastCopy = Date.distantPast
    var generation = 0
    var copying = false

    init() {
        // Re-check when returning from System Settings or unlocking the Mac.
        // No permission polling is needed while the machine is idle.
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            workspaceObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, self.watchSelection || self.doubleCopy else { return }
                self.refreshMonitors()
            })
        }
    }

    func status() -> [String: Any] {
        return ["accessibility": AXIsProcessTrusted(), "selection": watchSelection,
                "mouseMonitor": mouseMonitor != nil, "keyboardMonitor": keyboardMonitor != nil,
                "gestures": gestures, "captures": captures, "lastCapture": lastCapture]
    }

    func refreshMonitors(force: Bool = false) {
        let allowed = AXIsProcessTrusted()
        guard force || trusted != allowed else { return }
        trusted = allowed
        if let monitor = mouseMonitor { NSEvent.removeMonitor(monitor) }
        if let monitor = keyboardMonitor { NSEvent.removeMonitor(monitor) }
        mouseMonitor = nil
        keyboardMonitor = nil
        downPoint = nil
        generation += 1
        if watchSelection || doubleCopy {
            // Keep mouse observation separate: key events require Accessibility
            // permission, and a denied key monitor must not swallow mouse events.
            mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
                self?.handle(event)
            }
            if allowed {
                keyboardMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
                    self?.handle(event)
                }
            }
        }
        var state = status()
        state["event"] = "status"
        emit(state)
    }

    func emit(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }

    func reply(_ id: Any?, _ value: [String: Any]) {
        guard let id = id else { return }
        var response = value
        response["id"] = id
        emit(response)
    }

    func application() -> [String: Any] {
        guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
        return ["pid": Int(app.processIdentifier), "name": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? ""]
    }

    func point(_ event: NSEvent) -> CGPoint {
        return event.cgEvent?.location ?? CGEvent(source: nil)?.location ?? .zero
    }

    func configure(_ input: [String: Any]) {
        watchSelection = input["selection"] as? Bool ?? false
        doubleCopy = input["doubleCopy"] as? Bool ?? false
        clipboardTimer?.invalidate()
        clipboardTimer = nil
        previousChange = pasteboard.changeCount
        if input["clipboard"] as? Bool == true {
            let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
                guard let self = self, !self.copying else { return }
                let count = self.pasteboard.changeCount
                if count != self.previousChange {
                    self.previousChange = count
                    self.emit(["event": "clipboard"])
                }
            }
            timer.tolerance = 0.2
            RunLoop.main.add(timer, forMode: .common)
            clipboardTimer = timer
        }
        refreshMonitors(force: true)
    }

    func handle(_ event: NSEvent) {
        let location = point(event)
        let app = application()
        switch event.type {
        case .leftMouseDown:
            generation += 1
            downPoint = location
            downTime = Date()
            emit(["event": "pointerdown", "x": location.x, "y": location.y])
        case .leftMouseUp:
            guard watchSelection, app["pid"] as? Int != Int(ownerPID) else { return }
            let dragged = downPoint.map { hypot(location.x - $0.x, location.y - $0.y) >= 8 && Date().timeIntervalSince(downTime) >= 0.1 } ?? false
            guard dragged || event.clickCount >= 2 else { return }
            let token = generation
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
                guard let self = self, token == self.generation else { return }
                self.gestures += 1
                self.emit(["event": "selection-gesture", "x": location.x, "y": location.y, "application": app, "doubleClick": !dragged])
            }
        case .keyDown:
            // A real key press invalidates a pending copy; our own Cmd+C does not.
            if event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) != Int64(ProcessInfo.processInfo.processIdentifier) { generation += 1 }
            if event.keyCode == 53 { generation += 1; emit(["event": "escape"]) }
            if doubleCopy && !copying && event.keyCode == 8 && event.modifierFlags.contains(.command) {
                let now = Date()
                if now.timeIntervalSince(lastCopy) < 0.8 { emit(["event": "double-copy"]) }
                lastCopy = now
            }
        default: break
        }
    }

    func attribute(_ element: AXUIElement, _ key: CFString) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key, &result) == .success else { return nil }
        return result
    }

    func selectedText(_ pid: pid_t) -> (String?, Bool) {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        guard let value = attribute(app, kAXFocusedUIElementAttribute as CFString),
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return (nil, false) }
        let element = unsafeBitCast(value, to: AXUIElement.self)
        if attribute(element, kAXSubroleAttribute as CFString) as? String == "AXSecureTextField" {
            return (nil, true)
        }
        return (attribute(element, kAXSelectedTextAttribute as CFString) as? String, false)
    }

    func key(_ code: CGKeyCode) {
        let source = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
        down?.flags = .maskCommand
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }

    func capture(_ input: [String: Any]) {
        let id = input["id"]
        let pid = pid_t(input["pid"] as? Int ?? 0)
        captures += 1
        func empty(_ reason: String) {
            lastCapture = reason
            reply(id, ["text": "", "reason": reason])
        }
        guard AXIsProcessTrusted() else { empty("accessibility-denied"); return }
        guard !copying, pid > 0, pid != ownerPID,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            empty("focus-changed"); return
        }
        let (text, secure) = selectedText(pid)
        if secure { empty("secure-field"); return }
        if let text = text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lastCapture = "accessibility"
            reply(id, ["text": text, "method": "accessibility"]); return
        }
        // Finder copies files rather than selected text. Never turn a file drag into Copy.
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder" {
            empty("finder"); return
        }
        // Some PDF viewers and web canvases do not expose AXSelectedText.
        // Copy briefly, then restore every pasteboard representation, but only
        // while the clipboard still belongs to this capture operation.
        let saved: [[NSPasteboard.PasteboardType: Data]] = (pasteboard.pasteboardItems ?? []).map { item in
            var result: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { result[type] = data } }
            return result
        }
        let oldCount = pasteboard.changeCount
        let token = generation
        copying = true
        key(8)
        func finish(_ text: String, _ changedCount: Int?) {
            if let count = changedCount, pasteboard.changeCount == count {
                pasteboard.clearContents()
                let items = saved.map { values -> NSPasteboardItem in
                    let item = NSPasteboardItem()
                    for (type, data) in values { item.setData(data, forType: type) }
                    return item
                }
                if !items.isEmpty { pasteboard.writeObjects(items) }
            }
            previousChange = pasteboard.changeCount
            copying = false
            let result = token == generation ? text : ""
            lastCapture = result.isEmpty ? "no-selection" : "copy"
            reply(id, ["text": result, "method": "copy", "reason": result.isEmpty ? "no-selection" : ""])
        }
        func poll(_ remaining: Int) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
                let count = pasteboard.changeCount
                if token != generation || NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                    finish("", nil)
                } else if count != oldCount {
                    let value = pasteboard.string(forType: .string) ?? ""
                    finish(value, count)
                } else if remaining <= 0 || token != generation || NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                    finish("", nil)
                } else {
                    poll(remaining - 1)
                }
            }
        }
        poll(7)
    }

    func command(_ input: [String: Any]) {
        switch input["command"] as? String {
        case "configure": configure(input)
        case "capture": capture(input)
        case "frontmost": reply(input["id"], application())
        case "status":
            refreshMonitors()
            reply(input["id"], status())
        case "copy": key(8); reply(input["id"], [:])
        case "paste": key(9); reply(input["id"], [:])
        case "quit": NSApplication.shared.terminate(nil)
        default: break
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let helper = SelectionHelper()
helper.emit(["event": "ready", "accessibility": AXIsProcessTrusted()])
Thread.detachNewThread {
    while let line = readLine() {
        if let data = line.data(using: .utf8),
           let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            DispatchQueue.main.async { helper.command(input) }
        }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
