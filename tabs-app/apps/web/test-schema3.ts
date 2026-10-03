import { Schema } from "effect";
import { TrimmedString } from "../../packages/contracts/src/baseSchemas.ts";

const ProjectSettingId = TrimmedString;

const ProjectServerProcessDefinition = Schema.Struct({
  id: ProjectSettingId,
  label: TrimmedString,
  command: Schema.optionalKey(TrimmedString),
  commands: Schema.Array(TrimmedString).pipe(Schema.withDecodingDefault(() => [])),
  cwd: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  env: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefault(() => ({}))),
  autoStart: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  previewUrl: Schema.optionalKey(TrimmedString),
  autoOpenPreview: Schema.optionalKey(Schema.Boolean),
  previewOpenTarget: Schema.optionalKey(Schema.Literals(["in-app", "external"])),
});

const ProjectWorkspaceSettings = Schema.Struct({
  serverProcesses: Schema.Array(ProjectServerProcessDefinition).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});

try {
  const payload = {
    serverProcesses: [
      {
        id: "some-id",
        label: "Frontend",
        commands: ["npm run dev"],
        cwd: "/Users/rushil.dev/Downloads",
        env: {},
        autoStart: false,
        previewUrl: "http://localhost:5173/",
        autoOpenPreview: true,
        previewOpenTarget: "in-app",
      },
    ],
  };
  const result = Schema.decodeSync(ProjectWorkspaceSettings)(payload);
  console.log("Success:", result);
} catch (e) {
  console.log("Error:", e.message);
}
