/**
 * Permission and Capability Mediation for Embedded Browser Sessions.
 *
 * Implements strict, origin-aware and profile-scoped permission mediation to protect
 * user privacy and security while enabling 2FA, QR code scanning, and passkey/WebAuthn flows.
 *
 * Core principles:
 * 1. Only sanitized clipboard writes are granted automatically.
 * 2. High-risk permissions (camera, microphone, USB, HID, serial, local-fonts, geolocation)
 *    are NEVER silently granted.
 * 3. Scope remembered decisions strictly to (browserProfileId, requestingOrigin).
 * 4. Revocation support and consistent request/check handlers.
 * 5. Handles pending permission cancellation on tab navigation, closure, or profile switch.
 * 6. Accounts for OS-level permissions (e.g. macOS camera/mic TCC).
 * 7. Correct passkey capability reporting: HTTPS establishes a secure context, not proven
 *    working passkey hardware support. Verification codes (TOTP/SMS) remain distinct from passkeys.
 */

import * as Electron from "electron";

export type PermissionCategory =
  | "safe_allowed"
  | "high_risk_media"
  | "high_risk_hardware"
  | "high_risk_privacy"
  | "external_challenge"
  | "denied_unknown";

export interface PermissionDetails {
  readonly requestingUrl?: string | undefined;
  readonly isMainFrame?: boolean | undefined;
  readonly securityOrigin?: string | undefined;
  readonly mediaType?: "video" | "audio" | undefined;
  readonly externalURL?: string | undefined;
}

export interface WebAuthnSupportCheck {
  readonly supported: boolean;
  readonly isSecureContext: boolean;
  readonly fallbackRequired: boolean;
  readonly reason: string;
  readonly capability: "not_supported" | "secure_context_only" | "platform_passkey_ready";
  readonly isPasskeyDistinguishedFromVerificationCode: true;
}

export interface StoredPermissionRecord {
  readonly profileId: string;
  readonly origin: string;
  readonly permission: string;
  readonly granted: boolean;
  readonly updatedAt: number;
}

export interface PendingPermissionRequest {
  readonly requestId: string;
  readonly webContentsId?: number | undefined;
  readonly profileId: string;
  readonly origin: string;
  readonly permission: string;
  readonly details?: PermissionDetails | undefined;
  readonly callback: (granted: boolean) => void;
  readonly timer?: NodeJS.Timeout | undefined;
}

const SAFE_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

const HIGH_RISK_MEDIA = new Set(["media", "camera", "microphone"]);
const HIGH_RISK_HARDWARE = new Set(["usb", "hid", "serial", "midi", "midiSysex"]);
const HIGH_RISK_PRIVACY = new Set([
  "local-fonts",
  "display-capture",
  "geolocation",
  "clipboard-read",
  "notifications",
  "pointerLock",
  "fullscreen",
]);

export function categorizePermission(
  permission: string,
  _details?: PermissionDetails,
): PermissionCategory {
  if (SAFE_PERMISSIONS.has(permission)) {
    return "safe_allowed";
  }
  if (HIGH_RISK_MEDIA.has(permission)) {
    return "high_risk_media";
  }
  if (HIGH_RISK_HARDWARE.has(permission)) {
    return "high_risk_hardware";
  }
  if (HIGH_RISK_PRIVACY.has(permission)) {
    return "high_risk_privacy";
  }
  if (permission === "openExternal") {
    return "external_challenge";
  }
  return "denied_unknown";
}

export function extractOriginFromUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return "";
  }
}

export function isSecureWebContext(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether WebAuthn / Passkeys can be reliably invoked in the given context.
 *
 * HTTPS establishes a secure origin context, but does NOT prove that native platform
 * passkey hardware (Touch ID / Windows Hello) is functional in an embedded Electron
 * WebContents. Differentiates passkeys from application-level verification codes (SMS/TOTP).
 */
export function checkWebAuthnContext(
  rawUrl: string,
  options?: { isPlatformAuthenticatorAvailable?: boolean },
): WebAuthnSupportCheck {
  const secure = isSecureWebContext(rawUrl);
  if (!secure) {
    return {
      supported: false,
      isSecureContext: false,
      fallbackRequired: true,
      reason:
        "WebAuthn and passkeys require an HTTPS origin or localhost. Non-secure HTTP sessions cannot use credentials.",
      capability: "not_supported",
      isPasskeyDistinguishedFromVerificationCode: true,
    };
  }

  const hasPlatformAuthenticator = options?.isPlatformAuthenticatorAvailable ?? false;
  return {
    supported: hasPlatformAuthenticator,
    isSecureContext: true,
    fallbackRequired: !hasPlatformAuthenticator,
    reason: hasPlatformAuthenticator
      ? "Secure origin context with verified platform WebAuthn authenticator available."
      : "Secure origin established. Embedded WebContents has limited OS biometric passkey integration; use hardware FIDO2 keys, verification codes, or system browser for platform passkeys.",
    capability: hasPlatformAuthenticator ? "platform_passkey_ready" : "secure_context_only",
    isPasskeyDistinguishedFromVerificationCode: true,
  };
}

export class PermissionMediator {
  // Scoped: profileId -> origin -> permission -> StoredPermissionRecord
  private readonly rememberedDecisions = new Map<
    string,
    Map<string, Map<string, StoredPermissionRecord>>
  >();
  private readonly pendingRequests = new Map<string, PendingPermissionRequest>();
  private onPromptCallback?: (request: {
    requestId: string;
    profileId: string;
    origin: string;
    permission: string;
    details?: PermissionDetails | undefined;
  }) => void;

  private readonly sysPrefs?: {
    getMediaAccessStatus?: (mediaType: "camera" | "microphone" | "screen") => string;
  };

  constructor(sysPrefs?: {
    getMediaAccessStatus?: (mediaType: "camera" | "microphone" | "screen") => string;
  }) {
    let detectedSysPrefs: any = undefined;
    try {
      detectedSysPrefs = (Electron as any)?.systemPreferences;
    } catch {
      detectedSysPrefs = undefined;
    }
    this.sysPrefs = sysPrefs ?? detectedSysPrefs;
  }

  /**
   * Register a callback to present custom non-native UI prompts to the user.
   */
  setPromptHandler(
    handler: (request: {
      requestId: string;
      profileId: string;
      origin: string;
      permission: string;
      details?: PermissionDetails | undefined;
    }) => void,
  ): void {
    this.onPromptCallback = handler;
  }

  /**
   * Synchronous check handler (e.g. navigator.permissions.query).
   */
  evaluateCheck(
    permission: string,
    requestingOrigin: string,
    profileId: string = "default",
  ): boolean {
    const category = categorizePermission(permission);
    if (category === "safe_allowed") {
      return true;
    }
    const origin = extractOriginFromUrl(requestingOrigin) || requestingOrigin;
    const profileDecisions = this.rememberedDecisions.get(profileId);
    const originDecisions = profileDecisions?.get(origin);
    const record = originDecisions?.get(permission);
    return record?.granted ?? false;
  }

  /**
   * Synchronous evaluation of an incoming request (for headless or fallback evaluation).
   */
  evaluateRequest(
    permission: string,
    requestingUrl: string | undefined,
    details?: PermissionDetails,
    profileId: string = "default",
  ): boolean {
    const category = categorizePermission(permission, details);
    if (category === "safe_allowed") {
      return true;
    }

    const origin = extractOriginFromUrl(requestingUrl || details?.securityOrigin);
    if (!origin) {
      return false;
    }

    // Check OS permissions for media
    if (!this.checkOsMediaPermission(permission, details)) {
      return false;
    }

    // Check profile-scoped remembered decision
    const profileDecisions = this.rememberedDecisions.get(profileId);
    const originDecisions = profileDecisions?.get(origin);
    const record = originDecisions?.get(permission);
    if (record) {
      return record.granted;
    }

    // High risk permissions are never silently granted
    return false;
  }

  /**
   * Handles an asynchronous permission request from Electron session.setPermissionRequestHandler.
   */
  handlePermissionRequest(options: {
    webContentsId?: number | undefined;
    permission: string;
    requestingUrl?: string | undefined;
    details?: PermissionDetails | undefined;
    profileId: string;
    callback: (granted: boolean) => void;
  }): void {
    const { webContentsId, permission, requestingUrl, details, profileId, callback } = options;
    const category = categorizePermission(permission, details);

    // Safe permissions are granted automatically
    if (category === "safe_allowed") {
      callback(true);
      return;
    }

    // Unknown or invalid permissions denied immediately
    if (category === "denied_unknown") {
      callback(false);
      return;
    }

    const origin = extractOriginFromUrl(requestingUrl || details?.securityOrigin);
    if (!origin) {
      callback(false);
      return;
    }

    // Check OS-level permissions first
    if (!this.checkOsMediaPermission(permission, details)) {
      callback(false);
      return;
    }

    // Check profile-scoped remembered decision
    const profileDecisions = this.rememberedDecisions.get(profileId);
    const originDecisions = profileDecisions?.get(origin);
    const record = originDecisions?.get(permission);
    if (record) {
      callback(record.granted);
      return;
    }

    // If an interactive prompt handler is registered, queue a pending request
    if (this.onPromptCallback) {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeout = setTimeout(() => {
        this.finishPendingRequest(requestId, false);
      }, 30_000);

      const pending: PendingPermissionRequest = {
        requestId,
        webContentsId,
        profileId,
        origin,
        permission,
        details,
        callback,
        timer: timeout,
      };

      this.pendingRequests.set(requestId, pending);
      try {
        this.onPromptCallback({
          requestId,
          profileId,
          origin,
          permission,
          details,
        });
      } catch {
        this.finishPendingRequest(requestId, false);
      }
      return;
    }

    // Default fallback: deny high-risk permissions without prompt
    callback(false);
  }

  /**
   * Responds to a pending permission request (from user action in the UI).
   */
  respondDecision(requestId: string, granted: boolean, remember: boolean = true): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (remember) {
      this.recordDecision(pending.origin, pending.permission, granted, pending.profileId);
    }

    this.finishPendingRequest(requestId, granted);
    return true;
  }

  private finishPendingRequest(requestId: string, granted: boolean): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.delete(requestId);
    try {
      pending.callback(granted);
    } catch {
      // Ignore if webContents was already destroyed
    }
  }

  /**
   * Cancels all pending permission requests for a specific WebContents (e.g. on navigation or tab close).
   */
  cancelPendingRequestsForWebContents(webContentsId: number): void {
    for (const [requestId, req] of this.pendingRequests.entries()) {
      if (req.webContentsId === webContentsId) {
        this.finishPendingRequest(requestId, false);
      }
    }
  }

  /**
   * Checks OS-level media access permissions (macOS system preferences).
   */
  private checkOsMediaPermission(permission: string, details?: PermissionDetails): boolean {
    if (process.platform !== "darwin" || !this.sysPrefs?.getMediaAccessStatus) {
      return true;
    }

    const isVideo =
      permission === "camera" || permission === "media" || details?.mediaType === "video";
    const isAudio =
      permission === "microphone" || permission === "media" || details?.mediaType === "audio";

    if (isVideo) {
      const status = this.sysPrefs.getMediaAccessStatus("camera");
      if (status === "denied" || status === "restricted") {
        return false;
      }
    }

    if (isAudio) {
      const status = this.sysPrefs.getMediaAccessStatus("microphone");
      if (status === "denied" || status === "restricted") {
        return false;
      }
    }

    return true;
  }

  /**
   * Records a user decision strictly scoped to (profileId, origin, permission).
   */
  recordDecision(
    origin: string,
    permission: string,
    granted: boolean,
    profileId: string = "default",
  ): void {
    if (!origin) return;
    const cleanOrigin = extractOriginFromUrl(origin) || origin;

    let profileMap = this.rememberedDecisions.get(profileId);
    if (!profileMap) {
      profileMap = new Map();
      this.rememberedDecisions.set(profileId, profileMap);
    }

    let originMap = profileMap.get(cleanOrigin);
    if (!originMap) {
      originMap = new Map();
      profileMap.set(cleanOrigin, originMap);
    }

    originMap.set(permission, {
      profileId,
      origin: cleanOrigin,
      permission,
      granted,
      updatedAt: Date.now(),
    });
  }

  /**
   * Revokes a previously remembered permission decision.
   */
  revokeDecision(profileId: string, origin: string, permission: string): boolean {
    const cleanOrigin = extractOriginFromUrl(origin) || origin;
    const profileMap = this.rememberedDecisions.get(profileId);
    if (!profileMap) return false;
    const originMap = profileMap.get(cleanOrigin);
    if (!originMap) return false;

    const existed = originMap.delete(permission);
    if (originMap.size === 0) {
      profileMap.delete(cleanOrigin);
    }
    return existed;
  }

  /**
   * Lists all remembered decisions, optionally filtered by profile.
   */
  listDecisions(profileId?: string): StoredPermissionRecord[] {
    const records: StoredPermissionRecord[] = [];
    for (const [pId, profileMap] of this.rememberedDecisions.entries()) {
      if (profileId && pId !== profileId) continue;
      for (const originMap of profileMap.values()) {
        for (const record of originMap.values()) {
          records.push(record);
        }
      }
    }
    return records;
  }

  /**
   * Clears remembered decisions for one origin, or all origins if omitted, scoped by profile.
   */
  clearDecisions(origin?: string, profileId?: string): void {
    if (profileId) {
      const profileMap = this.rememberedDecisions.get(profileId);
      if (profileMap) {
        if (origin) {
          const cleanOrigin = extractOriginFromUrl(origin) || origin;
          profileMap.delete(cleanOrigin);
        } else {
          profileMap.clear();
        }
      }
      return;
    }

    if (origin) {
      const cleanOrigin = extractOriginFromUrl(origin) || origin;
      for (const profileMap of this.rememberedDecisions.values()) {
        profileMap.delete(cleanOrigin);
      }
    } else {
      this.rememberedDecisions.clear();
    }
  }

  hasRememberedDecision(
    origin: string,
    permission: string,
    profileId: string = "default",
  ): boolean {
    const cleanOrigin = extractOriginFromUrl(origin) || origin;
    return Boolean(this.rememberedDecisions.get(profileId)?.get(cleanOrigin)?.has(permission));
  }
}
