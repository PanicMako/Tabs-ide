export interface ApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: unknown;
}

// Resolve only bundled JSON pointers. Documentation must never fetch remote refs.
export function openapiParameters(contract: unknown, values: unknown): ApiParameter[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    let resolved: unknown = value;
    const seen = new Set<string>();
    for (;;) {
      if (!resolved || typeof resolved !== "object") throw new Error("Invalid API parameter.");
      const ref = (resolved as { $ref?: unknown }).$ref;
      if (ref === undefined) break;
      if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref) || seen.size >= 16)
        throw new Error("Invalid or cyclic local API parameter reference.");
      seen.add(ref);
      resolved = contract;
      for (const part of ref.slice(2).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        if (!resolved || typeof resolved !== "object" || !Object.hasOwn(resolved, key))
          throw new Error("Missing local API parameter reference.");
        resolved = (resolved as Record<string, unknown>)[key];
      }
    }
    const parameter = resolved as ApiParameter;
    if (typeof parameter.name !== "string" || !parameter.name || typeof parameter.in !== "string")
      throw new Error("API parameter is missing its name or location.");
    return parameter;
  });
}
