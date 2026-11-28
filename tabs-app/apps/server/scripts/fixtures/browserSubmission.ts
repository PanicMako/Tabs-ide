import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { BrowserWorkflowStage } from "@tabs/contracts";

type Profile = "Work" | "Personal";
const draftPath = "/draft/build-42";
const clearText = "No existing build";
const pauseText = "Replace existing build";
const statuses = {
  ready_to_upload: "Ready to upload",
  uploaded: "Uploaded",
  submitted: "Submitted",
  certified: "Certified",
  published: "Published",
} satisfies Record<BrowserWorkflowStage, string>;

/** Disposable local Store-like site with separate sessions and optional keyed submission. */
export async function startBrowserSubmission(
  port = 0,
  stagedUpload = false,
  {
    dropSubmitReply,
    dropUploadReply = false,
    idempotentSubmit = false,
    closeConnections = false,
    uploadOnSelect = false,
  }: {
    dropSubmitReply?: "beforeHeaders" | "afterHeaders";
    dropUploadReply?: boolean;
    idempotentSubmit?: boolean;
    closeConnections?: boolean;
    uploadOnSelect?: boolean;
  } = {},
) {
  const hasUpload = stagedUpload || uploadOnSelect;
  const initialStage: BrowserWorkflowStage = hasUpload ? "ready_to_upload" : "uploaded";
  const drafts = {
    Work: { stage: initialStage as BrowserWorkflowStage, replacement: false, submits: 0 },
    Personal: { stage: initialStage as BrowserWorkflowStage, replacement: false, submits: 0 },
  };
  const uploads: Record<Profile, Buffer[]> = { Work: [], Personal: [] };
  const submitRequests = { Work: 0, Personal: 0 };
  const submitRequestsWhileReplacement = { Work: 0, Personal: 0 };
  const submitKeys = { Work: randomUUID(), Personal: randomUUID() };
  const appliedKeys = new Set<string>();
  let droppedSubmitReplies = 0;
  let droppedUploadReplies = 0;
  let workDraftReadsAfterDroppedReply = 0;
  const trialCounts = () => ({
    submissions: { Work: drafts.Work.submits, Personal: drafts.Personal.submits },
    submitRequests: { ...submitRequests },
    submitRequestsWhileReplacement: { ...submitRequestsWhileReplacement },
    uploads: { Work: uploads.Work.length, Personal: uploads.Personal.length },
    stages: { Work: drafts.Work.stage, Personal: drafts.Personal.stage },
    droppedSubmitReplies,
    ...(dropUploadReply && { droppedUploadReplies }),
    workDraftReadsAfterDroppedReply,
  });
  const redirect = (response: import("node:http").ServerResponse, location: string) => {
    response.writeHead(303, { Location: location }).end();
  };
  const dropAfterHeaders = (response: import("node:http").ServerResponse) => {
    const partial = "<!doctype html><title>Build submission</title>";
    response.writeHead(200, { "Content-Length": Buffer.byteLength(partial) + 128 });
    response.write(partial);
    // Let Chromium receive the response headers before cutting off the body.
    const disconnect = setTimeout(() => response.destroy(), 100);
    response.once("close", () => clearTimeout(disconnect));
  };
  const server = createServer(async (request, response) => {
    if (closeConnections) response.setHeader("Connection", "close");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const route = request.url;
    if (request.method === "GET" && (route === "/Work" || route === "/Personal")) {
      response.setHeader(
        "Set-Cookie",
        `qa_profile=${route.slice(1)}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return redirect(response, draftPath);
    }
    const profile = request.headers.cookie?.match(
      /(?:^|; )qa_profile=(Work|Personal)(?:;|$)/,
    )?.[1] as Profile | undefined;
    if (!profile) {
      response.writeHead(403).end("Choose a disposable profile at /Work or /Personal.");
      return;
    }
    const draft = drafts[profile];
    if (request.method === "POST") {
      switch (route) {
        case "/upload": {
          const chunks: Buffer[] = [];
          let size = 0;
          request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65_536) request.destroy();
            else chunks.push(chunk);
          });
          request.on("end", () => {
            uploads[profile].push(Buffer.concat(chunks));
            draft.stage = "uploaded";
            if (profile === "Work" && dropUploadReply && droppedUploadReplies === 0) {
              droppedUploadReplies++;
              dropAfterHeaders(response);
            } else redirect(response, draftPath);
          });
          return;
        }
        case "/submit": {
          submitRequests[profile]++;
          if (draft.replacement) submitRequestsWhileReplacement[profile]++;
          if (idempotentSubmit) {
            let body = "";
            try {
              for await (const chunk of request) {
                body += String(chunk);
                if (body.length > 1024) {
                  response.writeHead(413).end();
                  return;
                }
              }
            } catch {
              return;
            }
            const keys = new URLSearchParams(body).getAll("submission_key");
            if (keys.length !== 1 || keys[0] !== submitKeys[profile]) {
              response.writeHead(409).end("The draft's submission key is invalid.");
              return;
            }
            const key = keys[0];
            if (appliedKeys.has(key)) return redirect(response, draftPath);
            appliedKeys.add(key);
          }
          draft.submits += 1;
          draft.stage = "submitted";
          if (profile === "Work" && dropSubmitReply && droppedSubmitReplies === 0) {
            droppedSubmitReplies++;
            if (dropSubmitReply === "beforeHeaders") {
              response.destroy();
            } else dropAfterHeaders(response);
            return;
          }
          break;
        }
        case "/toggle-replacement":
          draft.replacement = !draft.replacement;
          break;
        case "/certify":
          if (draft.stage === "submitted") draft.stage = "certified";
          break;
        case "/publish":
          if (draft.stage === "certified") draft.stage = "published";
          break;
        default:
          response.writeHead(404).end();
          return;
      }
      return redirect(response, draftPath);
    }
    if (request.method === "GET" && route === "/unrelated") {
      response.end("<!doctype html><title>Fixture home</title><p>Fixture home</p>");
      return;
    }
    if (request.method === "GET" && route === draftPath) {
      if (profile === "Work" && droppedSubmitReplies > 0) workDraftReadsAfterDroppedReply++;
      response.end(`<!doctype html>
        <title>Disposable build submission</title>
        <h1>Build submission</h1>
        <p>Profile <strong>${profile}</strong></p>
        <p>Draft <code id="build-id">build-42</code></p>
        <p>Status <strong id="build-status">${statuses[draft.stage]}</strong></p>
        <p id="replacement">${draft.replacement ? pauseText : clearText}</p>
        ${draft.stage === "ready_to_upload" ? `<form id="build-upload-form" method="post" action="/upload" enctype="multipart/form-data"><label>Build package <input id="build-package" type="file" required name="package"></label>${uploadOnSelect ? "" : '<button id="upload-build">Upload build</button>'}</form>` : ""}
        ${
          uploadOnSelect && draft.stage === "ready_to_upload"
            ? `<script>
          const form = document.querySelector("#build-upload-form");
          const status = document.querySelector("#build-status");
          status.dataset.fileEvents = "";
          form.addEventListener("input", () => { status.dataset.fileEvents += "input "; });
          form.addEventListener("change", async () => {
            status.dataset.fileEvents += "change ";
            try {
              const reply = await fetch(form.action, { method: "POST", body: new FormData(form) });
              if (!reply.ok) return;
              const draft = new DOMParser().parseFromString(await reply.text(), "text/html");
              const submit = draft.querySelector('form[action="/submit"]');
              if (!submit) return;
              form.replaceWith(submit);
              status.textContent = "Uploaded";
            } catch {
              // Leave the last visible status intact when the response is lost.
            }
          });
        </script>`
            : ""
        }
        ${
          draft.stage === "uploaded"
            ? `<form method="post" action="/submit"${idempotentSubmit ? ' data-tabs-submit-idempotency="submission_key"' : ""}>
          ${idempotentSubmit ? `<input type="hidden" name="submission_key" value="${submitKeys[profile]}">` : ""}
          <button id="submit-build">Submit build</button></form>`
            : ""
        }
        <details><summary>Fixture controls</summary>
          <p>Uploads recorded ${uploads[profile].length}</p>
          <p>Submit requests received ${submitRequests[profile]}</p>
          <p>Submissions recorded ${draft.submits}</p>
          <form method="post" action="/toggle-replacement"><button>Toggle replacement warning</button></form>
          <form method="post" action="/certify"><button>Simulate certification</button></form>
          <form method="post" action="/publish"><button>Simulate publication</button></form>
        </details>`);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener unavailable.");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    drafts,
    uploads,
    trialCounts,
    definition: {
      url: origin + draftPath,
      identitySelector: "#build-id",
      resourceId: "build-42",
      statusSelector: "#build-status",
      submitSelector: "#submit-build",
      ...(uploadOnSelect
        ? { uploadInputSelector: "#build-package" }
        : stagedUpload && { uploadSelector: "#upload-build" }),
      states: hasUpload
        ? statuses
        : {
            uploaded: statuses.uploaded,
            submitted: statuses.submitted,
            certified: statuses.certified,
            published: statuses.published,
          },
      breakpoint: { selector: "#replacement", clearText, pauseText },
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dropSubmitReply = process.argv.includes("--drop-submit-before-headers")
    ? "beforeHeaders"
    : process.argv.includes("--drop-submit-reply")
      ? "afterHeaders"
      : undefined;
  const fixture = await startBrowserSubmission(0, process.argv.includes("--staged-upload"), {
    ...(dropSubmitReply && { dropSubmitReply }),
    dropUploadReply: process.argv.includes("--drop-upload-reply"),
    idempotentSubmit: process.argv.includes("--idempotent-submit"),
    uploadOnSelect: process.argv.includes("--upload-on-select"),
  });
  console.log(
    `Use ${fixture.origin}/Work in your Work fixture profile. Ctrl+C prints trial counts.`,
  );
  console.log(JSON.stringify(fixture.definition, null, 2));
  if (dropSubmitReply)
    console.log(
      `The first Work Submit commits and disconnects ${dropSubmitReply === "beforeHeaders" ? "before" : "after"} HTTP response headers.`,
    );
  const closeTrial = async () => {
    await fixture.close();
    console.log(JSON.stringify(fixture.trialCounts()));
  };
  process.once("SIGINT", closeTrial);
  process.once("SIGTERM", closeTrial);
}
