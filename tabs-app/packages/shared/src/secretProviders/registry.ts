import { makeSecretProviderDefinitionRegistry } from "./definition.ts";
import * as OnePassword from "./onePassword.ts";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
