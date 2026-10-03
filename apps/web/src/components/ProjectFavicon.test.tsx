import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectFavicon } from "./ProjectFavicon";

describe("ProjectFavicon", () => {
  it("renders emoji override when specified", () => {
    const markup = renderToStaticMarkup(
      <ProjectFavicon
        project={{
          workspaceRoot: "/workspace/my-app",
          title: "My App",
          projectIcon: { kind: "emoji", emoji: "🚀" },
        }}
      />,
    );
    expect(markup).toContain("🚀");
  });

  it("renders fallback heuristic icon for known project domains", () => {
    const markup = renderToStaticMarkup(
      <ProjectFavicon
        project={{
          workspaceRoot: "/workspace/customer-api",
          title: "customer-api",
        }}
      />,
    );
    // customer-api is classified as 'server' with blue color
    expect(markup).toContain("text-blue-600");
  });

  it("renders fallback heuristic icon for database domains", () => {
    const markup = renderToStaticMarkup(
      <ProjectFavicon
        project={{
          workspaceRoot: "/workspace/my-database",
          title: "AnalyticsDatabase",
        }}
      />,
    );
    // AnalyticsDatabase is classified as 'database' with cyan color
    expect(markup).toContain("text-cyan-600");
  });

  it("renders with legacy cwd prop", () => {
    const markup = renderToStaticMarkup(<ProjectFavicon cwd="/workspace/shop-frontend" />);
    // shop-frontend is classified as 'shopping' with rose color
    expect(markup).toContain("text-rose-600");
  });
});
