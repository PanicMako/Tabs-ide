import { describe, expect, it } from "vitest";
import contract from "./public-openapi.json";
import { openapiParameters } from "../frontend/src/lib/openapiParameters";

describe("bundled API parameter reference resolution", () => {
  it("resolves the real overview identity parameters as required path inputs", () => {
    const parameters = openapiParameters(
      contract,
      contract.paths["/v1/extensions/{namespace}/{name}/overview"].get.parameters,
    );
    expect(
      parameters.map(({ name, in: location, required }) => ({ name, location, required })),
    ).toEqual([
      { name: "namespace", location: "path", required: true },
      { name: "name", location: "path", required: true },
    ]);
  });
  it("fails closed for missing, external and cyclic references", () => {
    for (const ref of ["https://example.com/parameter", "#/missing"])
      expect(() => openapiParameters({}, [{ $ref: ref }])).toThrow();
    const cyclic = { parameter: { $ref: "#/parameter" } };
    expect(() => openapiParameters(cyclic, [cyclic.parameter])).toThrow("cyclic");
  });
  it("resolves escaped pointer keys without reading inherited properties", () => {
    const parameter = { name: "id", in: "path", required: true };
    expect(openapiParameters({ "a/b~c": parameter }, [{ $ref: "#/a~1b~0c" }])).toEqual([parameter]);
    expect(() => openapiParameters({}, [{ $ref: "#/toString" }])).toThrow();
  });
});
