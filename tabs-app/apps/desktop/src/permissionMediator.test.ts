import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  PermissionMediator,
  categorizePermission,
  checkWebAuthnContext,
  extractOriginFromUrl,
  isSecureWebContext,
} from "./permissionMediator";

describe("permissionMediator", () => {
  let mediator: PermissionMediator;
  let mockSysPrefs: {
    getMediaAccessStatus: ((mediaType: "camera" | "microphone" | "screen") => string) & {
      mockReturnValue: (val: string) => void;
    };
  };

  beforeEach(() => {
    const fn = vi.fn((_mediaType: "camera" | "microphone" | "screen") => "granted");
    mockSysPrefs = {
      getMediaAccessStatus: fn as any,
    };
    mediator = new PermissionMediator(mockSysPrefs);
  });

  describe("categorizePermission", () => {
    it("only treats sanitized clipboard writes as safe", () => {
      expect(categorizePermission("clipboard-sanitized-write")).toBe("safe_allowed");
      expect(categorizePermission("clipboard-read")).toBe("high_risk_privacy");
      expect(categorizePermission("notifications")).toBe("high_risk_privacy");
      expect(categorizePermission("pointerLock")).toBe("high_risk_privacy");
      expect(categorizePermission("fullscreen")).toBe("high_risk_privacy");
    });

    it("recognizes high-risk media permissions", () => {
      expect(categorizePermission("camera")).toBe("high_risk_media");
      expect(categorizePermission("microphone")).toBe("high_risk_media");
      expect(categorizePermission("media")).toBe("high_risk_media");
    });

    it("recognizes high-risk hardware and privacy permissions", () => {
      expect(categorizePermission("usb")).toBe("high_risk_hardware");
      expect(categorizePermission("hid")).toBe("high_risk_hardware");
      expect(categorizePermission("serial")).toBe("high_risk_hardware");
      expect(categorizePermission("local-fonts")).toBe("high_risk_privacy");
      expect(categorizePermission("display-capture")).toBe("high_risk_privacy");
    });

    it("denies unknown permissions", () => {
      expect(categorizePermission("unknown-permission-xyz")).toBe("denied_unknown");
    });
  });

  describe("PermissionMediator profile scoping and revocation", () => {
    const origin = "https://app.example.com";
    const requestUrl = "https://app.example.com/dashboard";

    it("automatically grants safe permissions", () => {
      expect(mediator.evaluateRequest("clipboard-sanitized-write", requestUrl)).toBe(true);
      expect(mediator.evaluateRequest("clipboard-read", requestUrl)).toBe(false);
      expect(mediator.evaluateCheck("clipboard-read", origin)).toBe(false);
    });

    it("never silently grants camera or microphone", () => {
      expect(mediator.evaluateRequest("camera", requestUrl)).toBe(false);
      expect(mediator.evaluateRequest("microphone", requestUrl)).toBe(false);
      expect(mediator.evaluateCheck("camera", origin)).toBe(false);
    });

    it("never silently grants USB, HID, or local fonts", () => {
      expect(mediator.evaluateRequest("usb", requestUrl)).toBe(false);
      expect(mediator.evaluateRequest("hid", requestUrl)).toBe(false);
      expect(mediator.evaluateRequest("local-fonts", requestUrl)).toBe(false);
    });

    it("scopes decisions strictly by profile and origin", () => {
      mediator.recordDecision(origin, "camera", true, "work");

      // Granted for profile "work"
      expect(mediator.evaluateRequest("camera", requestUrl, undefined, "work")).toBe(true);
      expect(mediator.evaluateCheck("camera", origin, "work")).toBe(true);

      // NOT granted for profile "personal"
      expect(mediator.evaluateRequest("camera", requestUrl, undefined, "personal")).toBe(false);
      expect(mediator.evaluateCheck("camera", origin, "personal")).toBe(false);

      // NOT granted for another origin in "work"
      expect(mediator.evaluateRequest("camera", "https://other.com", undefined, "work")).toBe(
        false,
      );
    });

    it("supports revoking specific permissions for a profile and origin", () => {
      mediator.recordDecision(origin, "camera", true, "work");
      mediator.recordDecision(origin, "microphone", true, "work");

      expect(mediator.hasRememberedDecision(origin, "camera", "work")).toBe(true);
      expect(mediator.hasRememberedDecision(origin, "microphone", "work")).toBe(true);

      const revoked = mediator.revokeDecision("work", origin, "camera");
      expect(revoked).toBe(true);

      expect(mediator.evaluateRequest("camera", requestUrl, undefined, "work")).toBe(false);
      expect(mediator.evaluateRequest("microphone", requestUrl, undefined, "work")).toBe(true);
    });

    it("lists decisions accurately per profile", () => {
      mediator.recordDecision("https://site-a.com", "camera", true, "work");
      mediator.recordDecision("https://site-b.com", "microphone", true, "personal");

      const workDecisions = mediator.listDecisions("work");
      expect(workDecisions).toHaveLength(1);
      expect(workDecisions[0]?.origin).toBe("https://site-a.com");
      expect(workDecisions[0]?.permission).toBe("camera");

      const allDecisions = mediator.listDecisions();
      expect(allDecisions).toHaveLength(2);
    });

    it("clears decisions on demand scoped by profile", () => {
      mediator.recordDecision(origin, "camera", true, "work");
      mediator.recordDecision(origin, "camera", true, "personal");

      mediator.clearDecisions(origin, "work");
      expect(mediator.evaluateRequest("camera", requestUrl, undefined, "work")).toBe(false);
      expect(mediator.evaluateRequest("camera", requestUrl, undefined, "personal")).toBe(true);
    });
  });

  describe("PermissionMediator async prompt mediation and pending request handling", () => {
    it("notifies prompt handler on new permission request and grants when accepted", () => {
      let promptPayload: any = null;
      mediator.setPromptHandler((req) => {
        promptPayload = req;
      });

      let callbackResult: boolean | null = null;
      mediator.handlePermissionRequest({
        webContentsId: 42,
        permission: "camera",
        requestingUrl: "https://zoom.us/join",
        profileId: "work",
        callback: (granted) => {
          callbackResult = granted;
        },
      });

      expect(promptPayload).not.toBeNull();
      expect(promptPayload.origin).toBe("https://zoom.us");
      expect(promptPayload.permission).toBe("camera");
      expect(callbackResult).toBeNull(); // Still pending

      // User allows and remembers
      mediator.respondDecision(promptPayload.requestId, true, true);
      expect(callbackResult).toBe(true);

      // Now remembered for future checks
      expect(mediator.evaluateRequest("camera", "https://zoom.us/join", undefined, "work")).toBe(
        true,
      );
    });

    it("cancels pending requests when tab navigates or closes (webContents destroyed)", () => {
      let promptPayload: any = null;
      mediator.setPromptHandler((req) => {
        promptPayload = req;
      });

      let callbackResult: boolean | null = null;
      mediator.handlePermissionRequest({
        webContentsId: 99,
        permission: "microphone",
        requestingUrl: "https://meet.google.com",
        profileId: "work",
        callback: (granted) => {
          callbackResult = granted;
        },
      });

      expect(promptPayload).not.toBeNull();
      expect(callbackResult).toBeNull();

      // Tab navigates or closes
      mediator.cancelPendingRequestsForWebContents(99);
      expect(callbackResult).toBe(false);
    });

    it("enforces OS-level media access checks", () => {
      mockSysPrefs.getMediaAccessStatus.mockReturnValue("denied");

      let callbackResult: boolean | null = null;
      mediator.handlePermissionRequest({
        webContentsId: 10,
        permission: "camera",
        requestingUrl: "https://example.com",
        profileId: "work",
        callback: (granted) => {
          callbackResult = granted;
        },
      });

      // Refused immediately because OS denied it
      expect(callbackResult).toBe(false);
    });
  });

  describe("WebAuthn context and passkey support verification", () => {
    it("distinguishes secure context from platform passkey hardware support", () => {
      // Without platform authenticator: establishes secure context, but reports supported=false with clear capability
      const check = checkWebAuthnContext("https://github.com/login");
      expect(check.isSecureContext).toBe(true);
      expect(check.supported).toBe(false);
      expect(check.fallbackRequired).toBe(true);
      expect(check.capability).toBe("secure_context_only");
      expect(check.isPasskeyDistinguishedFromVerificationCode).toBe(true);
      expect(check.reason).toContain("limited OS biometric passkey integration");

      // When platform authenticator is verified
      const checkWithAuth = checkWebAuthnContext("https://github.com/login", {
        isPlatformAuthenticatorAvailable: true,
      });
      expect(checkWithAuth.isSecureContext).toBe(true);
      expect(checkWithAuth.supported).toBe(true);
      expect(checkWithAuth.fallbackRequired).toBe(false);
      expect(checkWithAuth.capability).toBe("platform_passkey_ready");
    });

    it("confirms secure contexts for localhost origins", () => {
      const check1 = checkWebAuthnContext("http://localhost:3000/auth");
      expect(check1.isSecureContext).toBe(true);

      const check2 = checkWebAuthnContext("http://127.0.0.1:8080/auth");
      expect(check2.isSecureContext).toBe(true);
    });

    it("requires external fallback for non-secure HTTP origins", () => {
      const check = checkWebAuthnContext("http://insecure-site.com/auth");
      expect(check.supported).toBe(false);
      expect(check.isSecureContext).toBe(false);
      expect(check.fallbackRequired).toBe(true);
      expect(check.capability).toBe("not_supported");
      expect(check.reason).toContain("require an HTTPS origin");
    });
  });

  describe("URL and origin utilities", () => {
    it("extracts origins accurately", () => {
      expect(extractOriginFromUrl("https://login.example.com:8443/oauth/token?foo=bar")).toBe(
        "https://login.example.com:8443",
      );
      expect(extractOriginFromUrl("invalid")).toBe("");
    });

    it("identifies secure contexts correctly", () => {
      expect(isSecureWebContext("https://secure.com")).toBe(true);
      expect(isSecureWebContext("http://localhost:5173")).toBe(true);
      expect(isSecureWebContext("http://127.0.0.1:5173")).toBe(true);
      expect(isSecureWebContext("http://example.com")).toBe(false);
    });
  });
});
