import { extensionDocs } from "../../../../../../marketing/src/lib/extension-docs";
import { renderReleaseMarkdown } from "../../../../../../marketing/src/lib/release-markdown";
import { documentationSections, registryApiSections } from "../../../scripts/documentationSearch";
import contract from "../../../../../src/public-openapi.json";
export function GET() {
  return Response.json([
    ...extensionDocs.flatMap((doc) =>
      documentationSections(
        doc.title,
        `/docs/extensions${doc.slug ? `/${doc.slug}` : ""}`,
        renderReleaseMarkdown(doc.body),
      ),
    ),
    ...registryApiSections(contract),
  ]);
}
