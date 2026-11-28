import * as Schema from "effect/Schema";

export class ComputerUseError extends Schema.TaggedError<ComputerUseError>()("ComputerUseError", {
  code: Schema.String,
  message: Schema.String,
}) {}
