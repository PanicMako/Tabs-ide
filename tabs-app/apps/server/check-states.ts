import { TestingGraphStore } from "./src/testing/graphStore";
import {
  normalizeStructuralSnapshot,
  normalizeAccessibilityForStorage,
} from "./src/testing/security";
import * as fs from "node:fs";

const store = new TestingGraphStore("/Users/rushil.dev/.tabs/dev/testing/state-graph.sqlite");
const graph = store.graph("eacfd757-b8f9-44c5-97e6-0ea299b4dbb4");

const newThreadStates = graph.nodes.filter((n) => n.pageTitle === "New thread");
console.log("Total new thread states:", newThreadStates.length);

const hashes = new Set();
for (const node of newThreadStates) {
  // We need to parse node.snapshot, which is already stored as the output of normalizeAccessibilityForStorage.
  // Wait, in crawler.ts:
  // const storedSnapshot = normalizeAccessibilityForStorage(tokenized.tokenized);
  // stateId = structuralHash(storedSnapshot);
  // structuralHash does: createHash("sha256").update(normalizeStructuralSnapshot(snapshot)).digest("hex");
  const norm = normalizeStructuralSnapshot(node.snapshot);
  hashes.add(norm);
}
console.log("Unique normalized structural snapshots:", hashes.size);

if (newThreadStates.length >= 2) {
  const s1 = normalizeStructuralSnapshot(newThreadStates[0].snapshot);
  const s2 = normalizeStructuralSnapshot(newThreadStates[1].snapshot);

  fs.writeFileSync("/tmp/s1.txt", s1);
  fs.writeFileSync("/tmp/s2.txt", s2);
}
