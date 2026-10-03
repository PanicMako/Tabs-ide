import { TestingGraphStore } from "./src/testing/graphStore";
import {
  normalizeStructuralSnapshot,
  normalizeAccessibilityForStorage,
  structuralHash,
} from "./src/testing/security";
import * as fs from "node:fs";

const store = new TestingGraphStore("/Users/rushil.dev/.tabs/dev/testing/state-graph.sqlite");
const graph = store.graph("eacfd757-b8f9-44c5-97e6-0ea299b4dbb4");

const newThreadStates = graph.nodes.filter((n) => n.pageTitle === "New thread");
console.log("Total new thread states:", newThreadStates.length);

const hashes = new Set();
for (const node of newThreadStates) {
  const norm1 = normalizeAccessibilityForStorage(node.snapshot);
  const hash = structuralHash(norm1);
  hashes.add(hash);
}
console.log("Unique hashes IF normalized today:", hashes.size);

if (hashes.size > 1) {
  const norm1 = normalizeAccessibilityForStorage(newThreadStates[0].snapshot);
  const norm2 = normalizeAccessibilityForStorage(newThreadStates[1].snapshot);

  fs.writeFileSync("/tmp/s1.yaml", normalizeStructuralSnapshot(norm1));
  fs.writeFileSync("/tmp/s2.yaml", normalizeStructuralSnapshot(norm2));
}
