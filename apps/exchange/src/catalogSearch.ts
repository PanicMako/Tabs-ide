// Fixed SQL fragments only. Search text is always supplied as a bound parameter.
export const CATALOG_DISPLAY_NAME = `lower(COALESCE(NULLIF(btrim(v.manifest->>'displayName'), ''), v.name)) COLLATE "C"`;
export const CATALOG_KEYWORD_MATCH = `EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(v.manifest->'listing'->'keywords') = 'array'
      THEN v.manifest->'listing'->'keywords' ELSE '[]'::jsonb END
  ) AS keyword(value) WHERE keyword.value ILIKE $1
)`;

export const CATALOG_RELEVANCE = `CASE
  WHEN lower(v.name) = lower($8::text)
    OR lower(v.namespace || '.' || v.name) = lower($8::text)
    OR lower(v.manifest->>'displayName') = lower($8::text) THEN 4
  WHEN v.namespace ILIKE $1 OR v.name ILIKE $1
    OR (v.namespace || '.' || v.name) ILIKE $1
    OR v.manifest->>'displayName' ILIKE $1 THEN 3
  WHEN ${CATALOG_KEYWORD_MATCH} THEN 2
  WHEN v.manifest->>'description' ILIKE $1 THEN 1
  ELSE 0 END`;

export function catalogPattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
