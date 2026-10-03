import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resetVersionMismatchDismissals } from "../versionSkew";
import { UpdateNotificationBanner } from "./UpdateNotificationBanner";

describe("UpdateNotificationBanner", () => {
  beforeEach(() => {
    resetVersionMismatchDismissals();
  });

  it("renders null when server and client versions match", () => {
    const html = renderToStaticMarkup(
      <UpdateNotificationBanner serverVersion="1.0.0" clientVersion="1.0.0" />,
    );
    expect(html).toBe("");
  });

  it("renders null when server version is missing or ahead", () => {
    const htmlMissing = renderToStaticMarkup(
      <UpdateNotificationBanner serverVersion={null} clientVersion="1.0.0" />,
    );
    expect(htmlMissing).toBe("");

    const htmlAhead = renderToStaticMarkup(
      <UpdateNotificationBanner serverVersion="2.0.0" clientVersion="1.0.0" />,
    );
    expect(htmlAhead).toBe("");
  });

  it("renders notification banner when server is behind client", () => {
    const html = renderToStaticMarkup(
      <UpdateNotificationBanner serverVersion="1.0.0" clientVersion="1.2.0" />,
    );
    expect(html).toContain('data-testid="update-notification-banner"');
    expect(html).toContain("Server is running v1.0.0, but client is v1.2.0");
    expect(html).toContain("Copy Update Command");
  });

  it("renders update action button when onUpdateClick is supplied", () => {
    const html = renderToStaticMarkup(
      <UpdateNotificationBanner
        serverVersion="1.0.0"
        clientVersion="1.2.0"
        onUpdateClick={() => {}}
      />,
    );
    expect(html).toContain("Update");
  });
});
