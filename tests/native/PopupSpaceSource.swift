import AppKit

// A different, regular macOS application for fullscreen integration tests.
// This fixture only manages its own window; it never synthesizes input or reads
// another app, the clipboard, or accessibility data.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}
class Delegate: NSObject, NSWindowDelegate {
    func windowDidEnterFullScreen(_ notification: Notification) { emit(["fullscreen": true]) }
    func windowDidExitFullScreen(_ notification: Notification) { emit(["fullscreen": false]) }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 360, y: 250, width: 760, height: 460),
                      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
window.title = "CopyTranslator 独立全屏空间测试"
window.collectionBehavior = [.fullScreenPrimary]
let delegate = Delegate()
window.delegate = delegate
let label = NSTextField(labelWithString: "正在检查其他应用全屏时的浮窗归属。测试结束后自动关闭。")
label.frame = NSRect(x: 30, y: 150, width: 700, height: 70)
label.font = .systemFont(ofSize: 20)
window.contentView?.addSubview(label)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.async { emit(["ready": true]) }
Thread.detachNewThread {
    while let command = readLine() {
        DispatchQueue.main.async {
            if command == "fullscreen" && !window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
            else if command == "windowed" && window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
            else if command == "quit" { app.terminate(nil) }
        }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { app.terminate(nil) }
app.run()
