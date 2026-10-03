import { Schema } from "effect";

try {
  const S = Schema.Literals(["in-app", "external"]);
  console.log("Is array allowed?", Schema.decodeSync(S)(["in-app", "external"]));
  console.log("Is string allowed?", Schema.decodeSync(S)("in-app"));
} catch (e) {
  console.log("Error:", e.message);
}
