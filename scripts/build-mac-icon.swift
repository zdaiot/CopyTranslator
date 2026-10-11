import AppKit

// macOS app icons include an optical margin. Keep the shared logo untouched
// for Windows and in-app controls, and center it on a transparent Mac canvas.
guard CommandLine.arguments.count == 3,
      let source = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
      ),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Usage: swift scripts/build-mac-icon.swift source.png output.png")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill(using: .copy)
source.draw(in: NSRect(x: 102, y: 102, width: 820, height: 820),
            from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode macOS icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
print("macOS icon: 1024 px transparent canvas, 820 px artwork (80%)")
