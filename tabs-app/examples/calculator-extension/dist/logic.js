globalThis.run = ({ commandId, input }) => {
  if (!input || !Number.isFinite(input.first) || !Number.isFinite(input.second)) {
    throw new Error("Both inputs must be finite numbers.");
  }
  if (commandId === "add") return input.first + input.second;
  if (commandId === "multiply") return input.first * input.second;
  throw new Error("Unknown command.");
};
