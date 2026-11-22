// Worker-thread side: wires the engine to a message port. Kept separate from the entry file so
// the tsdown entry stays a one-liner and this module is importable in tests.
import type { SessionSearchEngine } from "./engine.ts";
import type { WorkerMessage, WorkerRequest } from "./workerProtocol.ts";

export interface WorkerPort {
  postMessage: (message: WorkerMessage) => void;
  on: (event: "message", listener: (message: WorkerRequest) => void) => void;
}

export function hostEngine(engine: SessionSearchEngine, port: WorkerPort) {
  port.on("message", (request) => {
    try {
      switch (request.op) {
        case "query":
          return respond(port, request.id, engine.query(request.input));
        case "preview":
          return respond(port, request.id, engine.preview(request.input));
        case "status":
          return respond(port, request.id, engine.status());
        case "reindex":
          engine.reindex(request.full);
          return respond(port, request.id, engine.status());
        case "getSession":
          return respond(port, request.id, engine.getSession(request.agent, request.sessionId));
      }
    } catch (cause) {
      port.postMessage({
        kind: "response",
        id: request.id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
}

function respond(
  port: WorkerPort,
  id: number,
  result: Extract<WorkerMessage, { ok: true }>["result"],
) {
  port.postMessage({ kind: "response", id, ok: true, result });
}
