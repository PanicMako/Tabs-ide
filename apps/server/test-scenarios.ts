import { TestingGraphStore } from "./src/testing/graphStore";
import { scenariosFromGraph } from "./src/testing/reconciliation";

const store = new TestingGraphStore("/Users/rushil.dev/.tabs/dev/testing/state-graph.sqlite");
const graph = store.graph("eacfd757-b8f9-44c5-97e6-0ea299b4dbb4");
const scenarios = scenariosFromGraph(graph);

console.log("Total edges:", graph.edges.length);
console.log(JSON.stringify(scenarios, null, 2));
