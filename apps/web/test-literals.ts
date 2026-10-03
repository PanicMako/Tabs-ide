import { Schema } from "effect";

try {
  const S = Schema.Literals(["in-app", "external"]);
  const result = Schema.decodeSync(S)("in-app");
  console.log("Success:", result);
} catch (e) {
  console.log("Error:", e.message);
}
