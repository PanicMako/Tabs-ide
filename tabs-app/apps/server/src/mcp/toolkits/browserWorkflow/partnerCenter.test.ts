import { expect, test, vi } from "vitest";

import { getPartnerCenterSubmissionStatus, PartnerCenterError } from "./partnerCenter.ts";

const credential = {
  tenantId: "20000000-0000-0000-0000-000000000001",
  clientId: "20000000-0000-0000-0000-000000000002",
  clientSecret: "test-secret+with&form=characters",
};
const target = { applicationId: "9NBLGGH4R315", submissionId: "1152921504621243680" };
const input = { credential, approvedTarget: target, target };
const tokenUrl = `https://login.microsoftonline.com/${credential.tenantId}/oauth2/token`;
const submissionUrl = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${target.applicationId}/submissions/${target.submissionId}`;
const accessToken = "test.token-private";
const uploadUrl = "https://upload.example.test/blob?sig=private-upload-signature";

function mockFetch() {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
}

function tokenResponse() {
  return Response.json({ access_token: accessToken, token_type: "Bearer" });
}

test("uses the documented token and exact submission endpoints and projects safe fields", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(
      Response.json({
        id: target.submissionId,
        status: "Certification",
        fileUploadUrl: uploadUrl,
        notesForCertification: credential.clientSecret,
        statusDetails: { certificationReports: [{ reportUrl: uploadUrl }] },
        applicationPackages: [
          { fileName: "tabs.appx", version: "2.10.0.0", fileStatus: "Uploaded", id: accessToken },
          { version: "2.11.0.0", fileStatus: "PendingUpload" },
          { version: uploadUrl, fileStatus: "Uploaded" },
          { version: "2.9.0.0", fileStatus: accessToken },
        ],
      }),
    );

  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).resolves.toStrictEqual({
    ...target,
    status: "Certification",
    packageVersions: [
      { version: "2.10.0.0", fileStatus: "Uploaded" },
      { version: "2.11.0.0", fileStatus: "PendingUpload" },
    ],
  });

  expect(fetch).toHaveBeenCalledTimes(2);
  const [tokenRequest, submissionRequest] = fetch.mock.calls;
  expect(tokenRequest).toEqual([
    tokenUrl,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: expect.any(URLSearchParams),
      redirect: "error",
      signal: expect.any(AbortSignal),
    },
  ]);
  expect(tokenRequest?.[1].body?.toString()).toBe(
    `grant_type=client_credentials&client_id=${credential.clientId}&client_secret=test-secret%2Bwith%26form%3Dcharacters&resource=https%3A%2F%2Fmanage.devcenter.microsoft.com`,
  );
  expect(submissionRequest).toEqual([
    submissionUrl,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: tokenRequest?.[1].signal,
    },
  ]);
});

test.each([
  { ...target, applicationId: target.applicationId.toLowerCase() },
  { ...target, submissionId: "1152921504621243681" },
])("refuses a target outside the exact approval before authenticating", async (otherTarget) => {
  const fetch = mockFetch();
  await expect(
    getPartnerCenterSubmissionStatus({ ...input, target: otherTarget }, { fetch }),
  ).rejects.toMatchObject({ code: "target-not-approved" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { ...target, applicationId: "../another-app" },
  { ...target, submissionId: "encoded%2Fpath" },
])("rejects a route-bearing identifier even when supplied as approved", async (invalidTarget) => {
  const fetch = mockFetch();
  await expect(
    getPartnerCenterSubmissionStatus(
      { ...input, target: invalidTarget, approvedTarget: invalidTarget },
      { fetch },
    ),
  ).rejects.toMatchObject({ code: "invalid-target" });
  expect(fetch).not.toHaveBeenCalled();
});

test("refuses an invalid Entra tenant route before sending the secret", async () => {
  const fetch = mockFetch();
  await expect(
    getPartnerCenterSubmissionStatus(
      { ...input, credential: { ...credential, tenantId: "../other-tenant" } },
      { fetch },
    ),
  ).rejects.toMatchObject({ code: "invalid-credential" });
  expect(fetch).not.toHaveBeenCalled();
});

test("refuses a redirect at the token endpoint without making a Store request", async () => {
  const fetch = mockFetch().mockResolvedValueOnce(Response.redirect(uploadUrl, 307));
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "unexpected-response-route",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("refuses a Store response attributed to a different route", async () => {
  const response = Response.json({ id: target.submissionId, status: "Published" });
  Object.defineProperty(response, "url", { value: `${submissionUrl}/status` });
  const fetch = mockFetch().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response);
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "unexpected-response-route",
  });
  expect(response.bodyUsed).toBe(true);
});

test.each([
  { id: "1152921504621243681" },
  { id: `${target.submissionId} ` },
  { id: target.submissionId, applicationId: "9NBLGGH4R316" },
])("rejects a response with a different exact submission identity", async (identity) => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(Response.json({ ...identity, status: "Published" }));
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "submission-id-mismatch",
  });
});

test("does not coerce a numeric response ID", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(Response.json({ id: Number(target.submissionId), status: "Published" }));
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "invalid-submission",
  });
});

test("does not pass through arbitrary strings as a Store status", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(Response.json({ id: target.submissionId, status: uploadUrl }));
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "invalid-submission",
    message: "Microsoft Store returned an invalid submission response.",
  });
});

test("scopes an invalid bearer token to a fixed error and stops before the Store request", async () => {
  const fetch = mockFetch().mockResolvedValueOnce(
    Response.json({ access_token: `${accessToken}\r\nX-Test: ${credential.clientSecret}` }),
  );
  await expect(getPartnerCenterSubmissionStatus(input, { fetch })).rejects.toMatchObject({
    code: "invalid-token",
    message: "Microsoft Entra did not return a usable access token.",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  {
    stage: "Entra",
    code: "token-request-failed",
    message: "The Microsoft Entra token request failed.",
  },
  {
    stage: "Store",
    code: "submission-request-failed",
    message: "The Microsoft Store submission request failed.",
  },
])("discards the raw $stage error body", async ({ stage, code, message }) => {
  const fetch = mockFetch();
  if (stage === "Store") fetch.mockResolvedValueOnce(tokenResponse());
  const response = Response.json(
    { detail: [credential.clientSecret, accessToken, uploadUrl] },
    { status: 403 },
  );
  const json = vi.spyOn(response, "json");
  fetch.mockResolvedValueOnce(response);

  const lookup = getPartnerCenterSubmissionStatus(input, { fetch });
  await expect(lookup).rejects.toBeInstanceOf(PartnerCenterError);
  await expect(lookup).rejects.toMatchObject({ code, message });
  await expect(lookup).rejects.not.toHaveProperty("cause");
  expect(json).not.toHaveBeenCalled();
});

test("keeps a malformed successful response body out of the surfaced error", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(new Response(`${uploadUrl} ${accessToken} ${credential.clientSecret}`));
  const lookup = getPartnerCenterSubmissionStatus(input, { fetch });
  await expect(lookup).rejects.toMatchObject({
    code: "invalid-submission",
    message: "Microsoft Store returned an invalid submission response.",
  });
  await expect(lookup).rejects.not.toHaveProperty("cause");
});

test("discards fetch errors that can contain credentials or headers", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockRejectedValueOnce(new Error(`${uploadUrl} ${accessToken} ${credential.clientSecret}`));
  const lookup = getPartnerCenterSubmissionStatus(input, { fetch });
  await expect(lookup).rejects.toMatchObject({
    code: "submission-request-failed",
    message: "The Microsoft Store submission request failed.",
  });
  await expect(lookup).rejects.not.toHaveProperty("cause");
});

test("applies the lookup timeout to the response body as well as both requests", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(tokenResponse())
    .mockImplementationOnce(
      async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener("abort", () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        ),
    );
  await expect(
    getPartnerCenterSubmissionStatus(input, { fetch, timeoutMs: 25 }),
  ).rejects.toMatchObject({
    code: "timeout",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1].signal?.aborted).toBe(true);
});

test("stops before the Store request when the invoking turn is cancelled during authentication", async () => {
  const controller = new AbortController();
  const fetch = mockFetch().mockImplementationOnce(async () => {
    controller.abort(credential.clientSecret);
    return tokenResponse();
  });
  await expect(
    getPartnerCenterSubmissionStatus(input, { fetch, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
});
