import AppKit
import CryptoKit

let fixture = "Selection translation works across applications."
let fallback = CommandLine.arguments.contains("--fallback")
class CopyView: NSView {
    override var acceptsFirstResponder: Bool { true }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "c" {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(fixture, forType: .string)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 380, y: 350, width: 620, height: 180), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "CopyTranslator isolated selection test"
let text = NSTextView(frame: NSRect(x: 20, y: 20, width: 580, height: 140))
text.string = fixture
text.font = NSFont.systemFont(ofSize: 20)
window.contentView?.addSubview(text)
window.makeKeyAndOrderFront(nil)
if fallback {
    text.isHidden = true
    let view = CopyView(frame: window.contentView!.bounds)
    window.contentView?.addSubview(view)
    window.makeFirstResponder(view)
} else { window.makeFirstResponder(text) }
text.setSelectedRange(NSRange(location: 0, length: fixture.utf16.count))
app.activate(ignoringOtherApps: true)
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data + Data([10]))
}
func signature() -> String {
    let board = NSPasteboard.general
    var bytes = Data()
    for item in board.pasteboardItems ?? [] {
        for type in item.types.sorted(by: { $0.rawValue < $1.rawValue }) {
            bytes.append(Data(type.rawValue.utf8))
            if let data = item.data(forType: type) { bytes.append(data) }
        }
    }
    return SHA256.hash(data: bytes).description
}
let initialClipboard = signature()
DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { emit(["ready": true, "pid": ProcessInfo.processInfo.processIdentifier]) }
Thread.detachNewThread {
    while let line = readLine() {
        DispatchQueue.main.async {
            if line == "gesture" {
                // Generate a controlled drag inside this test window only.
                let frame = text.convert(text.bounds, to: nil)
                let start = window.convertPoint(toScreen: NSPoint(x: frame.minX + 8, y: frame.maxY - 18))
                let screenHeight = NSScreen.screens[0].frame.height
                let point = CGPoint(x: start.x, y: screenHeight - start.y)
                CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    let end = CGPoint(x: point.x + 440, y: point.y)
                    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
                    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
                }
            } else if line == "quit" {
                emit(["clipboardUnchanged": signature() == initialClipboard])
                app.terminate(nil)
            }
        }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 15) { app.terminate(nil) }
app.run()
