import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserSecurityBadge } from "./BrowserSecurityBadge";

describe("BrowserSecurityBadge", () => {
  it("renders null when securityContext or currentUrl is missing or about:blank", () => {
    const html1 = renderToStaticMarkup(
      <BrowserSecurityBadge securityContext={undefined} currentUrl="https://example.com" />,
    );
    expect(html1).toBe("");

    const html2 = renderToStaticMarkup(
      <BrowserSecurityBadge
        securityContext={{
          securityState: "secure",
          registrableDomain: "example.com",
          origin: "https://example.com",
          profileId: "default",
          isTabsOwned: true,
        }}
        currentUrl="about:blank"
      />,
    );
    expect(html2).toBe("");
  });

  it("renders verified domain and profile badge for secure HTTPS sessions", () => {
    const html = renderToStaticMarkup(
      <BrowserSecurityBadge
        securityContext={{
          securityState: "secure",
          registrableDomain: "github.com",
          origin: "https://github.com",
          profileId: "work",
          isTabsOwned: true,
          hasPunycodeWarning: false,
        }}
        currentUrl="https://github.com/login"
      />,
    );
    expect(html).toContain("github.com");
    expect(html).toContain("work");
  });

  it("renders certificate error badge when securityState is broken", () => {
    const html = renderToStaticMarkup(
      <BrowserSecurityBadge
        securityContext={{
          securityState: "broken",
          registrableDomain: "badssl.com",
          origin: "https://self-signed.badssl.com",
          profileId: "dev",
          isTabsOwned: true,
          certificateError: "net::ERR_CERT_AUTHORITY_INVALID",
        }}
        currentUrl="https://self-signed.badssl.com"
      />,
    );
    expect(html).toContain("Certificate Error");
  });

  it("renders warning for punycode homoglyph domains", () => {
    const html = renderToStaticMarkup(
      <BrowserSecurityBadge
        securityContext={{
          securityState: "secure",
          registrableDomain: "xn--gogle-qoa.com",
          origin: "https://xn--gogle-qoa.com",
          profileId: "default",
          isTabsOwned: true,
          hasPunycodeWarning: true,
        }}
        currentUrl="https://xn--gogle-qoa.com"
      />,
    );
    expect(html).toContain("Punycode / IDN");
  });

  it("renders Not Secure for HTTP connections", () => {
    const html = renderToStaticMarkup(
      <BrowserSecurityBadge
        securityContext={{
          securityState: "insecure",
          registrableDomain: "insecure.org",
          origin: "http://insecure.org",
          profileId: "default",
          isTabsOwned: true,
        }}
        currentUrl="http://insecure.org/login"
      />,
    );
    expect(html).toContain("Not Secure (HTTP)");
  });
});
