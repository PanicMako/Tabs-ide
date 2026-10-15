# WebSocket contract changes — batch240

Full32add22delete ws.ts changed hunks and complete210line tests reviewed. Existing contracts824test evidence reused. Changed imports reference split checkpoint module and explicit .ts paths. WS_METHODS spreads RPC method constants, while legacy WebSocketRequestBody only explicitly adds companion directory listing and asset URL payloads. Shared names alone do not guarantee legacy wire support for every V2 RPC.

New assertion decodes root directoryPath empty and draft-workspace-file signed media request. Handler presence traced in both wsServer and ws; selected legacy forwarding inspected. Tests assert decoding, not directory scope enforcement or native media URL loading. Existing Companion environment routing finding remains unresolved. No production edits; unchanged793line ws source remains separate scope.
