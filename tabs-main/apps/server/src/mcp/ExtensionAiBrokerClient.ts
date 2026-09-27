import type { DesktopExtensionAiTool } from "@tabs/contracts";

export interface ExtensionAiBrokerConfiguration {
  readonly endpoint: string;
  readonly token: string;
}

export class ExtensionAiBrokerClient {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(configuration: ExtensionAiBrokerConfiguration) {
    const url = new URL(configuration.endpoint);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !/^[a-f0-9]{64}$/.test(configuration.token)
    ) {
      throw new Error("Invalid desktop extension AI broker configuration.");
    }
    this.endpoint = url.origin;
    this.token = configuration.token;
  }

  async list(projectId: string): Promise<DesktopExtensionAiTool[]> {
    const result = await this.call("tools", { projectId });
    if (!result || typeof result !== "object" || !("tools" in result)) {
      throw new Error("Invalid extension AI tool inventory.");
    }
    const tools = (result as { tools: unknown }).tools;
    if (
      !Array.isArray(tools) ||
      tools.length > 96 ||
      tools.some(
        (tool) =>
          !tool ||
          typeof tool !== "object" ||
          typeof tool.name !== "string" ||
          !/^tabs_ext_[a-f0-9]{16}_[a-z][a-z0-9-]{1,62}$/.test(tool.name) ||
          typeof tool.extensionId !== "string" ||
          typeof tool.commandId !== "string" ||
          typeof tool.description !== "string" ||
          tool.description.length > 700,
      )
    ) {
      throw new Error("Invalid extension AI tool inventory.");
    }
    return tools as DesktopExtensionAiTool[];
  }

  async invoke(projectId: string, toolName: string, input: unknown): Promise<unknown> {
    const result = await this.call("invoke", { projectId, toolName, input });
    if (!result || typeof result !== "object" || !("result" in result)) {
      throw new Error("Invalid extension AI tool result.");
    }
    return (result as { result: unknown }).result;
  }

  private async call(path: "tools" | "invoke", body: unknown): Promise<unknown> {
    const response = await fetch(`${this.endpoint}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tabs-Extension-Broker-Token": this.token,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(7_000),
    });
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 256 * 1024) throw new Error("Extension AI broker response is too large.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error("Extension AI broker returned no response body.");
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 256 * 1024) {
        await response.body.cancel().catch(() => undefined);
        throw new Error("Extension AI broker response is too large.");
      }
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const result: unknown = JSON.parse(text);
    if (!response.ok) {
      const message =
        result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "Extension AI broker is unavailable.";
      throw new Error(message);
    }
    return result;
  }
}
