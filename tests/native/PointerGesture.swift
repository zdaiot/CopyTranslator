import AppKit
import ApplicationServices

// Real OS input for the isolated popup smoke test. DevTools mouse input does
// not reliably establish native pointer capture in a non-activating NSPanel.
let values = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard values.count == 4, AXIsProcessTrusted() else {
    fputs("Four coordinates and Accessibility permission are required.\n", stderr)
    exit(1)
}
let source = CGEventSource(stateID: .hidSystemState)
let original = CGEvent(source: source)?.location
let start = CGPoint(x: values[0], y: values[1])
let end = CGPoint(x: values[2], y: values[3])
func post(_ type: CGEventType, _ point: CGPoint) {
    CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}
post(.mouseMoved, start)
usleep(80000)
post(.leftMouseDown, start)
usleep(80000)
for step in 1...4 {
    let fraction = Double(step) / 4
    post(.leftMouseDragged, CGPoint(x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction))
    usleep(50000)
}
post(.leftMouseUp, end)
usleep(80000)
if let original = original { post(.mouseMoved, original) }
