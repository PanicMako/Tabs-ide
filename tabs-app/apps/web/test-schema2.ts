import { Schema } from "effect";
import { TrimmedString } from "../../packages/contracts/src/baseSchemas.ts";

const ProjectSettingId = TrimmedString;

const ProjectServerProcessDefinition = Schema.Struct({
  id: ProjectSettingId,
  label: TrimmedString,
  command: Schema.optionalKey(TrimmedString),
  commands: Schema.Array(TrimmedString).pipe(Schema.withDecodingDefault(() => [])),
  cwd: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  env: Schema.Record({ key: Schema.String, value: Schema.String }).pipe(
    Schema.withDecodingDefault(() => ({})),
  ),
  autoStart: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  previewUrl: Schema.optionalKey(TrimmedString),
  autoOpenPreview: Schema.optionalKey(Schema.Boolean),
  previewOpenTarget: Schema.optionalKey(Schema.Literals("in-app", "external")),
});

try {
  const result = Schema.decodeSync(ProjectServerProcessDefinition)({
    id: "test",
    label: "Frontend",
    commands: ["npm run dev"],
    cwd: "/some/path",
    env: {},
    autoStart: false,
    previewUrl: "http://localhost:5173/",
    autoOpenPreview: true,
  });
  console.log("Success:", result);
} catch (e) {
  console.log("Error:", e.message);
}
