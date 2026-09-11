import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveHoundBin, smokeTestHound } from "./spawn.js";

export interface HoundClientLike {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Owned-child Hound client: this server spawns ONE `hound` process at
 * startup and talks to it over stdio pipes (no TCP, no extra daemon).
 * When this server dies, the child dies with it — no orphan processes.
 */
export class HoundChildClient implements HoundClientLike {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  readonly bin: string;

  constructor(bin?: string) {
    this.bin = bin ?? resolveHoundBin();
  }

  async connect(timeoutMs?: number): Promise<void> {
    smokeTestHound(this.bin);
    const timeout = timeoutMs ?? parseInt(process.env.HOUND_TIMEOUT_MS ?? "120000", 10);
    this.transport = new StdioClientTransport({
      command: this.bin,
      args: [],
      stderr: "ignore",
    });
    this.client = new Client({ name: "think-tank-hound", version: "0.1.0" });
    await this.client.connect(this.transport, { timeout });
    // Fail-high-and-early: the proxy contract requires these two tools.
    const { tools } = await this.client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const required of ["mcp_smart_search", "mcp_smart_fetch"]) {
      if (!names.has(required)) {
        throw new Error(`Hound at ${this.bin} lacks required tool ${required} (has: ${[...names].join(", ")})`);
      }
    }
    console.error(`[INFO] [hound] connected to child ${this.bin} (${tools.length} tools)`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error("Hound child not connected");
    const res = await this.client.callTool({ name, arguments: args });
    return res;
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // best-effort: transport kill below is the real cleanup
    } finally {
      this.client = null;
    }
    try {
      await this.transport?.close();
    } catch {
      // ignore — child is gone or already reaped
    } finally {
      this.transport = null;
    }
  }
}
