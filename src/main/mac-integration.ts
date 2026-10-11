import { app } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import { createInterface } from "readline";
import { join } from "path";

class MacIntegration extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private options = { clipboard: false, selection: false, doubleCopy: false };
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private stopping = false;

  start() {
    if (process.platform !== "darwin" || this.child || this.stopping) return;
    const binary = app.isPackaged
      ? join(process.resourcesPath, "native", "selection-helper")
      : join(process.cwd(), "build", "native", process.arch, "selection-helper");
    const child = spawn(binary, [String(process.pid)], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        const request = this.pending.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(message.id);
          request.resolve(message);
        } else if (message.event) {
          this.emit(message.event, message);
        }
      } catch (error) {
        console.warn("Invalid response from macOS selection helper", error);
      }
    });
    child.stderr.on("data", (data) => console.warn("macOS helper:", String(data).trim()));
    child.on("error", (error) => this.emit("helper-error", error));
    child.on("close", () => {
      if (this.child === child) this.child = undefined;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("macOS selection helper stopped"));
      }
      this.pending.clear();
      lines.close();
    });
    child.stdin.on("error", (error) => this.emit("helper-error", error));
    this.send({ command: "configure", ...this.options });
  }

  private send(message: Record<string, any>) {
    if (this.child && this.child.stdin.writable) {
      this.child.stdin.write(JSON.stringify(message) + "\n");
    }
  }

  configure(options: Partial<typeof this.options>) {
    this.options = { ...this.options, ...options };
    if (!this.child && !Object.values(this.options).some(Boolean)) return;
    this.start();
    this.send({ command: "configure", ...this.options });
  }

  request(command: string, values: Record<string, any> = {}): Promise<any> {
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("macOS selection helper did not respond"));
      }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...values, command, id });
    });
  }

  stop() {
    this.stopping = true;
    this.send({ command: "quit" });
    this.child?.stdin.end();
  }
}

export const macIntegration = new MacIntegration();
macIntegration.on("helper-error", (error) => console.warn("macOS integration unavailable:", error.message));
