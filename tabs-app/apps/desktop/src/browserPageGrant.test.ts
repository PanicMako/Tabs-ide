import { describe, expect, it } from "vitest";
import {
  describeBrowserPageScope,
  getBrowserPageScope,
  matchesPageScope,
  PRIVATE_BROWSER_FIELD,
} from "./browserPageGrant";

describe("browser page scope", () => {
  it.each([
    [
      "https://docs.google.com/spreadsheets/d/Sheet-1/edit#gid=0",
      "https://docs.google.com/spreadsheets/d/Sheet-1/edit#gid=42",
      "https://docs.google.com/spreadsheets/d/Sheet-2/edit",
    ],
    [
      "https://docs.google.com/presentation/d/Slide_1/edit",
      "https://docs.google.com/presentation/d/Slide_1/present",
      "https://docs.google.com/document/d/Slide_1/edit",
    ],
    [
      "https://docs.google.com/document/d/e/Published1/pub",
      "https://docs.google.com/document/d/e/Published1/pub?embedded=true",
      "https://docs.google.com/document/d/e/Published2/pub",
    ],
    [
      "https://www.figma.com/design/File1/QA?node-id=1-2",
      "https://www.figma.com/design/File1/Renamed?node-id=3-4",
      "https://www.figma.com/design/File2/QA?node-id=1-2",
    ],
    [
      "https://www.figma.com/design/File1/QA?branch-id=Branch1",
      "https://www.figma.com/design/File1/QA?node-id=3-4&branch-id=Branch1",
      "https://www.figma.com/design/File1/QA?branch-id=Branch2",
    ],
    [
      "https://www.figma.com/design/File1/QA",
      "https://www.figma.com/design/File1/Renamed?node-id=10-20",
      "https://www.figma.com/design/File1/branch/Branch1/QA",
    ],
    [
      "https://www.figma.com/design/File1/branch/Branch1/QA",
      "https://www.figma.com/design/File1/%62ranch/Branch1/Renamed?node-id=3-4",
      "https://www.figma.com/design/File1/branch/Branch2/QA",
    ],
  ])("keeps %s scoped to its resource", (approved, sameResource, differentResource) => {
    const scope = getBrowserPageScope(approved)!;
    expect(matchesPageScope(scope, sameResource)).toBe(true);
    expect(matchesPageScope(scope, differentResource)).toBe(false);
  });

  it("keeps unrecognized Docs and Figma pages local to the approved address", () => {
    const docs = getBrowserPageScope("https://docs.google.com/document/u/0/")!;
    expect(matchesPageScope(docs, "https://docs.google.com/document/u/0/d/New/edit")).toBe(false);
    const figma = getBrowserPageScope("https://www.figma.com/files/team/123")!;
    expect(matchesPageScope(figma, "https://www.figma.com/files/team/456")).toBe(false);
  });

  it("requires the exact approved Partner Center URL", () => {
    const address = "https://partner.microsoft.com/dashboard/?draft=42";
    const scope = getBrowserPageScope(address)!;
    expect(matchesPageScope(scope, address)).toBe(true);
    expect(matchesPageScope(scope, "https://partner.microsoft.com/dashboard/?draft=43")).toBe(
      false,
    );
  });

  it("allows same-origin navigation in a generic app and excludes sign-in pages", () => {
    const scope = getBrowserPageScope("https://work.tabs.test/upload")!;
    expect(matchesPageScope(scope, "https://work.tabs.test/drafts/receipt")).toBe(true);
    expect(matchesPageScope(scope, "https://work.tabs.test/login")).toBe(false);
    expect(matchesPageScope(scope, "https://personal.tabs.test/drafts/receipt")).toBe(false);
  });
});

describe("page grant reach", () => {
  it("describes an ordinary origin grant as all pages on that origin", () => {
    const scope = getBrowserPageScope("https://example.com/inbox")!;
    expect(describeBrowserPageScope(scope, "work")).toBe(
      "all pages on https://example.com in the work profile",
    );
    expect(matchesPageScope(scope, "https://example.com/settings/billing")).toBe(true);
    expect(matchesPageScope(scope, "https://other.example.com/inbox")).toBe(false);
  });

  it.each([
    "org",
    "orgs",
    "o",
    "t",
    "team",
    "teams",
    "workspace",
    "workspaces",
    "w",
    "company",
    "tenant",
    "tenants",
  ])("scopes /%s/<name> to that tenant", (segment) => {
    const scope = getBrowserPageScope(`https://app.example.com/${segment}/acme/projects/1`)!;
    expect(scope.tenant).toBe(`/${segment}/acme`);
    expect(matchesPageScope(scope, `https://app.example.com/${segment}/acme/settings`)).toBe(true);
    expect(matchesPageScope(scope, `https://app.example.com/${segment}/ACME/settings`)).toBe(true);
    expect(matchesPageScope(scope, `https://app.example.com/${segment}/globex/settings`)).toBe(
      false,
    );
    expect(matchesPageScope(scope, "https://app.example.com/")).toBe(false);
    expect(describeBrowserPageScope(scope)).toBe(
      `all pages under https://app.example.com/${segment}/acme`,
    );
  });

  it("does not treat a lone selector segment or ordinary paths as a tenant", () => {
    expect(getBrowserPageScope("https://app.example.com/team")!.tenant).toBeNull();
    expect(getBrowserPageScope("https://app.example.com/teams/")!.tenant).toBeNull();
    expect(getBrowserPageScope("https://app.example.com/projects/acme")!.tenant).toBeNull();
  });
});

describe("private browser fields", () => {
  const isPrivate = new Function(`return ${PRIVATE_BROWSER_FIELD}`)() as (
    element: unknown,
  ) => boolean;
  const field = (
    attributes: Record<string, string> = {},
    { type = "text", value = "", matching = "input,textarea,select" } = {},
  ) => ({
    id: attributes.id,
    value,
    labels: [],
    matches: (selector: string) => {
      if (selector.includes("[contenteditable=true]")) return true;
      if (selector.startsWith("input[type=password]")) {
        const auto = attributes.autocomplete ?? "";
        return (
          type === "password" ||
          /current-password|new-password|one-time-code|webauthn|cc-|bday/.test(auto)
        );
      }
      return selector === matching
        ? true
        : type === "email" && selector.startsWith("input[type=email]");
    },
    getAttribute: (name: string) => attributes[name] ?? null,
  });

  it.each([
    "Social security number",
    "SSN",
    "Date of birth",
    "dob",
    "Tax ID",
    "TIN",
    "EIN",
    "VAT number",
    "IBAN",
    "Routing number",
    "Account number",
    "Sort code",
    "Passport no",
    "Driver licence number",
    "License number",
    "PIN",
    "CVV",
    "CVC",
    "Security code",
    "OTP",
    "One-time code",
    "Verification code",
    "Contraseña",
    "Mot de passe",
    "Passwort",
    "Kennwort",
    "Senha",
    "パスワード",
    "密码",
    "Пароль",
    "Codice fiscale",
    "DNI",
    "NIE",
    "CPF",
    "RG",
    "Personalausweis",
  ])("treats %s as private", (label) => {
    expect(isPrivate(field({ "aria-label": label }))).toBe(true);
  });

  it.each([
    "cc-number",
    "cc-exp",
    "one-time-code",
    "current-password",
    "new-password",
    "bday-day",
    "section-x bday",
  ])("honours autocomplete=%s", (autocomplete) => {
    expect(isPrivate(field({ autocomplete, "aria-label": "Field" }))).toBe(true);
  });

  it("leaves ordinary fields alone", () => {
    for (const label of ["Search", "Project name", "Title", "Spinner", "Pinned"])
      expect(isPrivate(field({ "aria-label": label }))).toBe(false);
  });
});
