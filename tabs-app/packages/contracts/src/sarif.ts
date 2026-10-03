import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SarifMessage = Schema.Struct({
  text: Schema.String,
  markdown: Schema.optional(Schema.String),
});
export type SarifMessage = typeof SarifMessage.Type;

export const SarifArtifactLocation = Schema.Struct({
  uri: Schema.String,
  uriBaseId: Schema.optional(Schema.String),
  index: Schema.optional(Schema.Number),
});
export type SarifArtifactLocation = typeof SarifArtifactLocation.Type;

export const SarifRegion = Schema.Struct({
  startLine: Schema.optional(Schema.Number),
  startColumn: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  snippet: Schema.optional(
    Schema.Struct({
      text: Schema.String,
    }),
  ),
});
export type SarifRegion = typeof SarifRegion.Type;

export const SarifPhysicalLocation = Schema.Struct({
  artifactLocation: SarifArtifactLocation,
  region: Schema.optional(SarifRegion),
});
export type SarifPhysicalLocation = typeof SarifPhysicalLocation.Type;

export const SarifLocation = Schema.Struct({
  physicalLocation: Schema.optional(SarifPhysicalLocation),
  message: Schema.optional(SarifMessage),
});
export type SarifLocation = typeof SarifLocation.Type;

export const SarifRule = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.optional(Schema.String),
  shortDescription: Schema.optional(SarifMessage),
  fullDescription: Schema.optional(SarifMessage),
  helpUri: Schema.optional(Schema.String),
  defaultConfiguration: Schema.optional(
    Schema.Struct({
      level: Schema.optional(Schema.Literals(["none", "note", "warning", "error"])),
    }),
  ),
});
export type SarifRule = typeof SarifRule.Type;

export const SarifDriver = Schema.Struct({
  name: TrimmedNonEmptyString,
  version: Schema.optional(Schema.String),
  informationUri: Schema.optional(Schema.String),
  rules: Schema.optional(Schema.Array(SarifRule)),
});
export type SarifDriver = typeof SarifDriver.Type;

export const SarifTool = Schema.Struct({
  driver: SarifDriver,
});
export type SarifTool = typeof SarifTool.Type;

export const SarifResult = Schema.Struct({
  ruleId: Schema.optional(Schema.String),
  ruleIndex: Schema.optional(Schema.Number),
  level: Schema.optional(Schema.Literals(["none", "note", "warning", "error"])),
  message: SarifMessage,
  locations: Schema.optional(Schema.Array(SarifLocation)),
  fingerprints: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type SarifResult = typeof SarifResult.Type;

export const SarifRun = Schema.Struct({
  tool: SarifTool,
  results: Schema.optional(Schema.Array(SarifResult)),
});
export type SarifRun = typeof SarifRun.Type;

export const SarifLog = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  version: Schema.Literal("2.1.0"),
  runs: Schema.Array(SarifRun),
});
export type SarifLog = typeof SarifLog.Type;
