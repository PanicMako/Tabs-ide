import type {
  SessionSearchAgent,
  SessionSearchPreviewInput,
  SessionSearchPreviewResult,
  SessionSearchQueryInput,
  SessionSearchQueryResult,
  SessionSearchStatus,
} from "@tabs/contracts";

import type { SessionSearchRoots } from "./discovery.ts";
import type { StoredSession } from "./store.ts";

export interface WorkerInit {
  readonly dbPath: string;
  readonly roots: SessionSearchRoots;
}

export type WorkerRequest =
  | { readonly id: number; readonly op: "query"; readonly input: SessionSearchQueryInput }
  | { readonly id: number; readonly op: "status" }
  | { readonly id: number; readonly op: "preview"; readonly input: SessionSearchPreviewInput }
  | { readonly id: number; readonly op: "reindex"; readonly full: boolean }
  | {
      readonly id: number;
      readonly op: "getSession";
      readonly agent: SessionSearchAgent;
      readonly sessionId: string;
    };

export type WorkerResult =
  | SessionSearchQueryResult
  | SessionSearchPreviewResult
  | SessionSearchStatus
  | StoredSession
  | null;

export type WorkerMessage =
  | { readonly kind: "ready" }
  | { readonly kind: "status"; readonly status: SessionSearchStatus }
  | {
      readonly kind: "response";
      readonly id: number;
      readonly ok: true;
      readonly result: WorkerResult;
    }
  | { readonly kind: "response"; readonly id: number; readonly ok: false; readonly error: string };
