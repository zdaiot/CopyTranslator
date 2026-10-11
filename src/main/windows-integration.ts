import { app } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";
import { join } from "path";

// PowerShell ships with Windows; UI Automation and the STA clipboard API avoid
// depending on an Electron-version-specific FFI binary.
class WindowsIntegration {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private start() {
    if (this.child) return;
    const script = app.isPackaged ? join(process.resourcesPath, "native", "SelectionHelper.ps1") : join(process.cwd(), "native", "windows", "SelectionHelper.ps1");
    const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
    this.child = child;
    const fail = (error: Error) => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
    };
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const result = JSON.parse(line);
        const request = this.pending.get(result.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(result.id);
        if (result.error) request.reject(new Error(result.error)); else request.resolve(result);
      } catch { /* Ignore PowerShell startup messages, never treat them as text. */ }
    });
    child.stderr.on("data", () => { /* Errors returned by the request channel. */ });
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", () => { this.child = undefined; lines.close(); fail(new Error("Windows selection helper stopped")); });
  }
  request(command: string, values: Record<string, any> = {}): Promise<any> {
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A hung UI Automation provider must not build up a command queue.
        this.child?.kill();
        this.pending.delete(id);
        reject(new Error("Windows selection helper timed out"));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...values, command, id }) + "\n");
    });
  }
  stop() { this.child?.stdin.end(); }
}
export const windowsIntegration = new WindowsIntegration();
