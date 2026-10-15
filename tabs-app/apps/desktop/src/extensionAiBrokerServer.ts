import * as Crypto from "node:crypto";
import * as Http from "node:http";
import type { AddressInfo } from "node:net";
import type { DesktopExtensionAiTool } from "@tabs/contracts";

const MAX_REQUEST_BYTES = 128 * 1024;

export interface ExtensionAiBrokerHost {
  listAiToolsForProject(projectId: string): DesktopExtensionAiTool[];
  invokeAiTool(projectId: string, toolName: string, input: unknown): Promise<unknown>;
}

/** Only the server child receives this per-launch token, through its bootstrap pipe. */
export class ExtensionAiBrokerServer {
  private server: Http.Server | null = null;
  private token = "";

  constructor(private readonly host: ExtensionAiBrokerHost) {}

  async start(): Promise<{ readonly endpoint: string; readonly token: string }> {
    if (this.server) throw new Error("Extension AI broker is already running.");
    this.token = Crypto.randomBytes(32).toString("hex");
    const server = Http.createServer((request, response) => {
      void this.handle(request, response);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    } catch (error) {
      this.token = "";
      throw error;
    }
    this.server = server;
    return {
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      token: this.token,
    };
  }

  close(): void {
    this.token = "";
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }

  private async handle(
    request: Http.IncomingMessage,
    response: Http.ServerResponse,
  ): Promise<void> {
    const reply = (status: number, body: unknown) => {
      if (response.writableEnded) return;
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(body));
    };
    const supplied = request.headers["x-tabs-extension-broker-token"];
    const expected = Buffer.from(this.token);
    const actual = typeof supplied === "string" ? Buffer.from(supplied) : Buffer.alloc(0);
    if (
      !this.token ||
      actual.length !== expected.length ||
      !Crypto.timingSafeEqual(actual, expected)
    ) {
      reply(401, { error: "Unauthorized." });
      return;
    }
    if (request.method !== "POST" || !["/tools", "/invoke"].includes(request.url ?? "")) {
      reply(404, { error: "Not found." });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_REQUEST_BYTES) {
          reply(413, { error: "Request is too large." });
          request.destroy();
          return;
        }
        chunks.push(buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        reply(400, { error: "Invalid request." });
        return;
      }
      const input = body as Record<string, unknown>;
      if (typeof input.projectId !== "string" || !input.projectId || input.projectId.length > 200) {
        reply(400, { error: "Invalid project ID." });
        return;
      }
      if (request.url === "/tools") {
        reply(200, { tools: this.host.listAiToolsForProject(input.projectId) });
        return;
      }
      if (
        typeof input.toolName !== "string" ||
        !/^tabs_ext_[a-f0-9]{16}_[a-z][a-z0-9-]{1,62}$/.test(input.toolName)
      ) {
        reply(400, { error: "Invalid AI tool name." });
        return;
      }
      const result = await this.host.invokeAiTool(input.projectId, input.toolName, input.input);
      reply(200, { result });
    } catch (error) {
      reply(400, { error: error instanceof Error ? error.message : "Extension AI tool failed." });
    }
  }
}
