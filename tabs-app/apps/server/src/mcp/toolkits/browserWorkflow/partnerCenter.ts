import { PartnerCenterSubmissionState } from "@tabs/contracts";

const storeOrigin = "https://manage.devcenter.microsoft.com";
const defaultTimeoutMs = 10_000;
const entraIdPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const storeIdPattern = /^[a-z\d_-]{1,128}$/i;
const bearerTokenPattern = /^[a-z\d._~+/-]+=*$/i;

const packageFileStates = ["None", "PendingUpload", "Uploaded", "PendingDelete"] as const;

export interface PartnerCenterCredential {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface PartnerCenterSubmissionTarget {
  readonly applicationId: string;
  readonly submissionId: string;
}

interface PartnerCenterPackageVersion {
  readonly version: string;
  readonly fileStatus: (typeof packageFileStates)[number];
}

export interface PartnerCenterSubmissionStatus extends PartnerCenterSubmissionTarget {
  readonly status: PartnerCenterSubmissionState;
  readonly packageVersions?: readonly PartnerCenterPackageVersion[];
}

const errorMessages = {
  "target-not-approved":
    "The requested Microsoft Store application and submission were not approved.",
  "invalid-target": "The Microsoft Store application or submission ID is invalid.",
  "invalid-credential": "The Microsoft Entra application credential is invalid.",
  "invalid-timeout": "The Partner Center request timeout is invalid.",
  "unexpected-response-route": "Microsoft returned an unexpected response route.",
  "token-request-failed": "The Microsoft Entra token request failed.",
  "invalid-token": "Microsoft Entra did not return a usable access token.",
  "lookup-approval-changed": "The approved Store draft changed. Review the lookup again.",
  "submission-request-failed": "The Microsoft Store submission request failed.",
  "submission-id-mismatch": "Microsoft Store returned a different submission identity.",
  "invalid-submission": "Microsoft Store returned an invalid submission response.",
  cancelled: "The Microsoft Store submission lookup was cancelled.",
  timeout: "The Microsoft Store submission lookup timed out.",
} as const;

export class PartnerCenterError extends Error {
  constructor(readonly code: keyof typeof errorMessages) {
    super(errorMessages[code]);
    this.name = "PartnerCenterError";
  }
}

type PartnerCenterFetch = (url: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageVersions(value: unknown): PartnerCenterPackageVersion[] {
  if (!Array.isArray(value)) return [];

  const packages: PartnerCenterPackageVersion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { version, fileStatus } = entry;
    const state = packageFileStates.find((candidate) => candidate === fileStatus);
    if (state && typeof version === "string" && /^\d{1,5}(?:\.\d{1,5}){3}$/.test(version)) {
      packages.push({ version, fileStatus: state });
    }
  }
  return packages;
}

async function fetchJson(
  fetchRequest: PartnerCenterFetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  requestFailure: "token-request-failed" | "submission-request-failed",
  invalidResponse: "invalid-token" | "invalid-submission",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchRequest(url, { ...init, redirect: "error", signal });
  } catch {
    throw new PartnerCenterError(signal.aborted ? "timeout" : requestFailure);
  }

  if (
    response.redirected ||
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400) ||
    (response.url !== "" && response.url !== url)
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new PartnerCenterError("unexpected-response-route");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new PartnerCenterError(requestFailure);
  }

  try {
    return await response.json();
  } catch {
    throw new PartnerCenterError(signal.aborted ? "timeout" : invalidResponse);
  }
}

/** `approvedTarget` must come from the caller's approval for this exact lookup. */
export async function getPartnerCenterSubmissionStatus(
  input: {
    readonly credential: PartnerCenterCredential;
    readonly approvedTarget: PartnerCenterSubmissionTarget;
    readonly target: PartnerCenterSubmissionTarget;
  },
  options: {
    readonly fetch?: PartnerCenterFetch;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly beforeSubmission?: (signal: AbortSignal) => Promise<void>;
  } = {},
): Promise<PartnerCenterSubmissionStatus> {
  const { applicationId, submissionId } = input.target;
  if (
    applicationId !== input.approvedTarget.applicationId ||
    submissionId !== input.approvedTarget.submissionId
  ) {
    throw new PartnerCenterError("target-not-approved");
  }
  if (
    typeof applicationId !== "string" ||
    typeof submissionId !== "string" ||
    !storeIdPattern.test(applicationId) ||
    !storeIdPattern.test(submissionId)
  ) {
    throw new PartnerCenterError("invalid-target");
  }

  const { tenantId, clientId, clientSecret } = input.credential;
  if (
    typeof tenantId !== "string" ||
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    !entraIdPattern.test(tenantId) ||
    !entraIdPattern.test(clientId) ||
    !clientSecret.trim()
  ) {
    throw new PartnerCenterError("invalid-credential");
  }

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new PartnerCenterError("invalid-timeout");
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  if (options.signal?.aborted) throw new PartnerCenterError("cancelled");
  const fetchRequest = options.fetch ?? fetch;

  // Store submission API authentication uses the Entra v1 endpoint and a resource.
  const token = await fetchJson(
    fetchRequest,
    `https://login.microsoftonline.com/${tenantId}/oauth2/token`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        resource: storeOrigin,
      }),
    },
    signal,
    "token-request-failed",
    "invalid-token",
  );
  if (
    !isRecord(token) ||
    typeof token.access_token !== "string" ||
    !bearerTokenPattern.test(token.access_token)
  ) {
    throw new PartnerCenterError("invalid-token");
  }

  if (options.beforeSubmission) await options.beforeSubmission(signal);
  if (signal.aborted)
    throw new PartnerCenterError(options.signal?.aborted ? "cancelled" : "timeout");
  const submission = await fetchJson(
    fetchRequest,
    `${storeOrigin}/v1.0/my/applications/${applicationId}/submissions/${submissionId}`,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token.access_token}` },
    },
    signal,
    "submission-request-failed",
    "invalid-submission",
  );
  if (!isRecord(submission) || typeof submission.id !== "string") {
    throw new PartnerCenterError("invalid-submission");
  }
  if (
    submission.id !== submissionId ||
    ("applicationId" in submission && submission.applicationId !== applicationId)
  ) {
    throw new PartnerCenterError("submission-id-mismatch");
  }
  const status = PartnerCenterSubmissionState.literals.find(
    (candidate) => candidate === submission.status,
  );
  if (!status) throw new PartnerCenterError("invalid-submission");

  const packageVersions = readPackageVersions(submission.applicationPackages);
  return {
    applicationId,
    submissionId,
    status,
    ...(packageVersions.length > 0 ? { packageVersions } : {}),
  };
}
