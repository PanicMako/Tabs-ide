import { describe, expect, it } from "vitest";
import { displayAddress, recentBrowserPages, resolveOmniboxInput } from "./browserOmnibox";

describe("resolveOmniboxInput", () => {
  it("opens addresses and searches everything else", () => {
    expect(resolveOmniboxInput("example.com")).toBe("https://example.com/");
    expect(resolveOmniboxInput("docs.rs/serde")).toBe("https://docs.rs/serde");
    expect(resolveOmniboxInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(resolveOmniboxInput("https://a.dev/x?y=1")).toBe("https://a.dev/x?y=1");
    expect(resolveOmniboxInput("how to center a div")).toBe(
      "https://www.google.com/search?q=how%20to%20center%20a%20div",
    );
    expect(resolveOmniboxInput("react")).toBe("https://www.google.com/search?q=react");
  });

  it("treats a bare port as localhost", () => {
    expect(resolveOmniboxInput("3000")).toBe("http://localhost:3000/");
    expect(resolveOmniboxInput(":8080")).toBe("http://localhost:8080/");
  });

  it("rejects empty input", () => {
    expect(() => resolveOmniboxInput("   ")).toThrow();
  });
});

describe("displayAddress", () => {
  it("drops the scheme, www and a bare trailing slash", () => {
    expect(displayAddress("https://www.example.com/")).toBe("example.com");
    expect(displayAddress("http://localhost:3000/app?x=1")).toBe("localhost:3000/app?x=1");
    expect(displayAddress("not a url")).toBe("not a url");
    expect(displayAddress(null)).toBe("");
  });
});

describe("recentBrowserPages", () => {
  it("lists other open pages once each, newest first", () => {
    const pages = recentBrowserPages(
      {
        a: {
          activeId: null,
          tabs: [
            { id: "1", kind: "browser", url: "https://example.com/", title: "Example" },
            { id: "2", kind: "files" },
          ],
        },
        b: {
          activeId: null,
          tabs: [
            { id: "3", kind: "browser", url: "https://www.example.com/", title: "Again" },
            { id: "4", kind: "browser", url: "http://localhost:3000/", title: "Browser" },
            { id: "5", kind: "browser" },
          ],
        },
      },
      "4",
    );
    expect(pages).toEqual([{ url: "https://www.example.com/", title: "Again" }]);
  });
});
