import { describe, expect, it } from "vitest";
import contract from "./public-openapi.json";

describe("public registry publication metadata contract", () => {
  it("describes unknown publication dates using OpenAPI 3.1 null types", () => {
    expect(contract.openapi).toBe("3.1.0");
    const publication = contract.components.schemas.Release.properties.first_published_at;
    expect(publication.type).toEqual(["string", "null"]);
    expect(publication.format).toBe("date-time");
    expect(publication.description).toContain("Re-signing does not reset it");
    expect(publication).not.toHaveProperty("nullable");
  });

  it("documents newest, display-name sorting, and rejected legacy cursors", () => {
    const parameters = contract.paths["/v1/extensions"].get.parameters;
    expect(parameters.find((parameter) => parameter.name === "sort")?.description).toContain(
      "unknown historical dates last",
    );
    expect(parameters.find((parameter) => parameter.name === "sort")?.description).toContain(
      "case-folded display name",
    );
    expect(parameters.find((parameter) => parameter.name === "cursor")?.description).toContain(
      "restart without a cursor",
    );
  });
});
