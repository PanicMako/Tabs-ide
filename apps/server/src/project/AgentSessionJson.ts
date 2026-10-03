import * as SchemaAST from "effect/SchemaAST";

type JsonPath = ReadonlyArray<string | number | null>;

export class TranscriptJsonLimitError extends Error {}

/** Select schema fields before assembling their values, without a second field list. */
export function createTranscriptJsonSelector(schema: { readonly ast: SchemaAST.AST }) {
  const ast = SchemaAST.toEncoded(schema.ast);
  const includes = (node: SchemaAST.AST, path: JsonPath, index: number): boolean => {
    if (index === path.length) return true;
    switch (node._tag) {
      case "Objects":
        // Records have dynamic keys. Keep their values for the decoder to validate.
        if (node.indexSignatures.length > 0) return true;
        return node.propertySignatures.some(
          (property) =>
            String(property.name) === path[index] && includes(property.type, path, index + 1),
        );
      case "Arrays": {
        const key = path[index];
        if (typeof key !== "number") return true;
        const element = node.elements[key];
        if (element) return includes(element, path, index + 1);
        return node.rest.length === 0 || node.rest.some((item) => includes(item, path, index + 1));
      }
      case "Union":
        return node.types.some((type) => includes(type, path, index));
      case "Suspend":
        return includes(node.thunk(), path, index);
      case "Unknown":
      case "Any":
      case "ObjectKeyword":
      case "Declaration":
        // Unstructured/custom schemas must reach the decoder intact.
        return true;
      default:
        return false;
    }
  };
  return (path: JsonPath) => includes(ast, path, 0);
}

/**
 * Project a single JSONL record without materializing unselected string values.
 * The caller supplies a shared allocation budget for the entire transcript.
 * Budget exhaustion rejects the transcript, never a message within it.
 */
export function createTranscriptJsonReader(
  reserve: (bytes: number) => void,
  selectPath: (path: JsonPath) => boolean,
) {
  let buffer = "";

  return {
    write: (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) {
        throw new TranscriptJsonLimitError("Transcript record exceeds 32 MiB buffer limit");
      }
    },
    finish: (): unknown => {
      if (buffer.trim().length === 0) return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer);
      } catch {
        return undefined;
      }

      let currentDepth = 0;
      const processValue = (val: unknown, path: Array<string | number>): unknown => {
        currentDepth++;
        if (currentDepth > 128) {
          throw new TranscriptJsonLimitError("Transcript JSON nesting exceeds 128 levels");
        }
        try {
          if (typeof val === "string") {
            reserve(64 + val.length * 2);
            return val;
          }
          if (typeof val === "number" || typeof val === "boolean" || val === null) {
            reserve(64);
            return val;
          }
          if (Array.isArray(val)) {
            reserve(64);
            const result: unknown[] = [];
            for (let i = 0; i < val.length; i++) {
              path.push(i);
              if (selectPath(path)) {
                result.push(processValue(val[i], path));
              }
              path.pop();
            }
            return result;
          }
          if (typeof val === "object") {
            reserve(64);
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(val)) {
              reserve(k.length * 2);
              path.push(k);
              if (selectPath(path)) {
                result[k] = processValue(v, path);
              }
              path.pop();
            }
            return result;
          }
          return val;
        } finally {
          currentDepth--;
        }
      };

      const path: Array<string | number> = [];
      return processValue(parsed, path);
    },
  };
}
