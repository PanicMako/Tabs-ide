import { TestingService } from "./apps/server/src/testing/TestingService";
import { homedir } from "os";
import { join } from "path";

async function main() {
  const stateDir = join(homedir(), ".tabs", "dev");
  const service = new TestingService(stateDir);
  const projectId = "eacfd757-b8f9-44c5-97e6-0ea299b4dbb4";

  console.log("Before Generation 1: " + service.listCases({ projectId }).cases.length);

  service.generateScenarios({ projectId });
  console.log("After Generation 1: " + service.listCases({ projectId }).cases.length);

  service.generateScenarios({ projectId });
  console.log("After Generation 2: " + service.listCases({ projectId }).cases.length);

  service.close();
}
main().catch(console.error);
