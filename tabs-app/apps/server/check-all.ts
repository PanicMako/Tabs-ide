import { TestingGraphStore } from "./src/testing/graphStore";
import { normalizeAccessibilityForStorage, structuralHash } from "./src/testing/security";

const store = new TestingGraphStore("/Users/rushil.dev/.tabs/dev/testing/state-graph.sqlite");
const graph = store.graph("eacfd757-b8f9-44c5-97e6-0ea299b4dbb4");

console.log("Original Nodes:", graph.nodes.length);
console.log("Original Edges:", graph.edges.length);

const hashes = new Set();
for (const node of graph.nodes) {
  const norm = normalizeAccessibilityForStorage(node.snapshot);
  hashes.add(structuralHash(norm));
}
console.log("Unique Node Hashes if re-crawled today:", hashes.size);
