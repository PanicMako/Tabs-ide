import { parseBlockedDigestBatch } from "./publisherBatch.js";

const status = document.getElementById("status");
let publishingEnabled = false;
let termsVersion = null;

function announce(message, error = false) {
  status.textContent = message;
  status.setAttribute("role", error ? "alert" : "status");
  status.focus();
}

function csrfToken() {
  const entry = document.cookie.split("; ").find((part) => part.startsWith("tabs_exchange_csrf="));
  return entry ? entry.slice("tabs_exchange_csrf=".length) : "";
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

function mutation(method, body, contentType) {
  return {
    method,
    headers: { "X-CSRF-Token": csrfToken(), "Content-Type": contentType },
    body,
  };
}

function item(list, text) {
  const li = document.createElement("li");
  li.textContent = text;
  list.append(li);
  return li;
}

function listText(value) {
  return Array.isArray(value) && value.length ? value.join(", ") : "none";
}

function reviewHistoryDisclosure(entry) {
  const details = document.createElement("details");
  const heading = document.createElement("summary");
  heading.textContent = `Publisher and review history for ${entry.namespace}.${entry.name}`;
  const state = document.createElement("p");
  state.setAttribute("role", "status");
  const content = document.createElement("div");
  details.append(heading, state, content);
  let loaded = false;
  let loading = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded || loading) return;
    loading = true;
    state.setAttribute("role", "status");
    state.textContent = "Loading publisher and review history.";
    try {
      const history = await requestJson(`/v1/review/${entry.namespace}/${entry.name}/history`);
      content.replaceChildren();
      const versionsHeading = document.createElement("h4");
      versionsHeading.textContent = "Submitted versions";
      const versions = document.createElement("ul");
      for (const version of history.versions) {
        item(
          versions,
          `${version.version}: ${version.status}. SHA-256 ${version.digest}. Uploaded by ${version.uploader_login} at ${version.submitted_at}.${version.reviewer_login ? ` Reviewed by ${version.reviewer_login} at ${version.reviewed_at}.` : ""}${version.review_reason ? ` Reason: ${version.review_reason}` : ""}`,
        );
      }
      if (!history.versions.length) item(versions, "No submitted versions found.");
      const decisionsHeading = document.createElement("h4");
      decisionsHeading.textContent = "Review actions";
      const decisions = document.createElement("ul");
      for (const decision of history.decisions) {
        item(
          decisions,
          `${decision.action} ${decision.version}: SHA-256 ${decision.digest}. ${decision.reviewer_login} at ${decision.created_at}. Reason: ${decision.reason}`,
        );
      }
      if (!history.decisions.length) item(decisions, "No review actions recorded yet.");
      content.append(versionsHeading, versions, decisionsHeading, decisions);
      state.textContent = "History loaded. Each list shows up to 100 recent entries.";
      loaded = true;
    } catch (error) {
      state.setAttribute("role", "alert");
      state.textContent = `Could not load history: ${String(error)}`;
    } finally {
      loading = false;
    }
  });
  return details;
}

async function refreshNamespaces() {
  const data = await requestJson("/v1/publisher/namespaces");
  const list = document.getElementById("namespaces");
  list.replaceChildren();
  for (const namespace of data.namespaces) {
    const li = item(
      list,
      `${namespace.name} (${namespace.role}${namespace.verified ? ", verified" : ", unverified"})`,
    );
    if (namespace.role !== "owner") continue;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Manage ${namespace.name} members`;
    const state = document.createElement("p");
    state.setAttribute("role", "status");
    const members = document.createElement("ul");
    const pendingHeading = document.createElement("h4");
    pendingHeading.textContent = "Pending invitations";
    const pending = document.createElement("ul");
    details.append(summary, state, members, pendingHeading, pending);
    details.addEventListener("toggle", async () => {
      if (!details.open) return;
      state.textContent = "Loading namespace members.";
      try {
        const result = await requestJson(`/v1/namespaces/${namespace.name}/members`);
        members.replaceChildren();
        const ownerCount = result.members.filter((member) => member.role === "owner").length;
        for (const member of result.members) {
          const row = item(
            members,
            `${member.login} (GitHub ID ${member.user_id}, ${member.role}). `,
          );
          if (member.role === "owner" && ownerCount <= 1) {
            row.append("The last owner cannot be removed.");
            continue;
          }
          const label = document.createElement("label");
          label.textContent = `Reason to remove ${member.login} `;
          const reason = document.createElement("input");
          reason.maxLength = 2000;
          reason.required = true;
          label.append(reason);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = `Remove ${member.login} from ${namespace.name}`;
          remove.addEventListener("click", async () => {
            if (!reason.value.trim()) {
              announce("Enter a reason before removing a namespace member.", true);
              reason.focus();
              return;
            }
            remove.disabled = true;
            try {
              await requestJson(
                `/v1/namespaces/${namespace.name}/members/${member.user_id}`,
                mutation(
                  "DELETE",
                  JSON.stringify({ reason: reason.value.trim() }),
                  "application/json",
                ),
              );
              announce(`Removed ${member.login} from ${namespace.name}.`);
              await refreshNamespaces();
            } catch (error) {
              announce(String(error), true);
              remove.disabled = false;
            }
          });
          row.append(label, remove);
        }
        pending.replaceChildren();
        for (const invitation of result.invitations) {
          const row = item(
            pending,
            `${invitation.login} (GitHub ID ${invitation.user_id}, ${invitation.role}), expires ${invitation.expires_at}. `,
          );
          const label = document.createElement("label");
          label.textContent = `Reason to cancel ${invitation.login}'s invitation `;
          const reason = document.createElement("input");
          reason.maxLength = 2000;
          reason.required = true;
          label.append(reason);
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.textContent = `Cancel ${invitation.login}'s invitation to ${namespace.name}`;
          cancel.addEventListener("click", async () => {
            if (!reason.value.trim()) {
              announce("Enter a reason before cancelling an invitation.", true);
              reason.focus();
              return;
            }
            cancel.disabled = true;
            try {
              await requestJson(
                `/v1/namespaces/${namespace.name}/invitations/${invitation.id}/cancel`,
                mutation(
                  "POST",
                  JSON.stringify({ reason: reason.value.trim() }),
                  "application/json",
                ),
              );
              announce(`Cancelled ${invitation.login}'s invitation to ${namespace.name}.`);
              await refreshNamespaces();
            } catch (error) {
              announce(String(error), true);
              cancel.disabled = false;
            }
          });
          row.append(label, cancel);
        }
        if (!result.invitations.length) item(pending, "No pending invitations.");
        state.textContent = `${result.members.length} member(s) and ${result.invitations.length} pending invitation(s) loaded.`;
      } catch (error) {
        state.setAttribute("role", "alert");
        state.textContent = `Could not load members: ${String(error)}`;
      }
    });
    li.append(details);
  }
  if (data.namespaces.length === 0) item(list, "No namespaces yet.");
}

async function refreshInvitations() {
  const data = await requestJson("/v1/publisher/invitations");
  const list = document.getElementById("invitations");
  list.replaceChildren();
  for (const invitation of data.invitations) {
    const li = item(
      list,
      `${invitation.namespace}: ${invitation.role} invitation from ${invitation.inviter_login}, expires ${invitation.expires_at}. `,
    );
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = `Accept ${invitation.role} invitation for ${invitation.namespace}`;
    accept.disabled = !publishingEnabled;
    const termsLabel = document.createElement("label");
    const terms = document.createElement("input");
    terms.type = "checkbox";
    terms.required = true;
    termsLabel.append(terms, " I accept the ");
    const termsLink = document.createElement("a");
    termsLink.href = "/publisher-terms";
    termsLink.textContent = "publisher terms";
    termsLabel.append(termsLink, ` (version ${termsVersion}).`);
    li.append(termsLabel);
    accept.addEventListener("click", async () => {
      if (!terms.checked) {
        announce("Accept the publisher terms before joining a namespace.", true);
        terms.focus();
        return;
      }
      accept.disabled = true;
      try {
        await requestJson(
          `/v1/publisher/invitations/${invitation.id}/accept`,
          mutation(
            "POST",
            JSON.stringify({ acceptTermsVersion: termsVersion }),
            "application/json",
          ),
        );
        announce(`Joined ${invitation.namespace} as ${invitation.role}.`);
        await Promise.all([refreshInvitations(), refreshNamespaces()]);
      } catch (error) {
        announce(String(error), true);
        accept.disabled = false;
      }
    });
    li.append(accept);
    const decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = `Decline invitation for ${invitation.namespace}`;
    decline.addEventListener("click", async () => {
      decline.disabled = true;
      try {
        await requestJson(
          `/v1/publisher/invitations/${invitation.id}/decline`,
          mutation("POST", "{}", "application/json"),
        );
        announce(`Declined invitation for ${invitation.namespace}.`);
        await refreshInvitations();
      } catch (error) {
        announce(String(error), true);
        decline.disabled = false;
      }
    });
    li.append(decline);
  }
  if (!data.invitations.length) item(list, "No pending invitations.");
}

async function refreshSubmissions() {
  const data = await requestJson("/v1/publisher/submissions");
  const list = document.getElementById("submissions");
  list.replaceChildren();
  for (const entry of data.submissions) {
    const li = item(
      list,
      `${entry.namespace}.${entry.name}@${entry.version}: ${entry.status === "approved" && !entry.published ? "approved, awaiting signed publication" : entry.status}. SHA-256 ${entry.digest}${entry.review_reason ? `. Reviewer: ${entry.review_reason}` : ""}`,
    );
    if (entry.status !== "rejected" && entry.status !== "revoked") continue;
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = `Appeal or correction details for ${entry.namespace}.${entry.name}@${entry.version} `;
    const message = document.createElement("textarea");
    message.required = true;
    message.maxLength = 4000;
    label.append(message);
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Send appeal";
    form.append(label, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await requestJson(
          `/v1/publisher/${entry.namespace}/${entry.name}/versions/${encodeURIComponent(entry.version)}/appeals`,
          mutation(
            "POST",
            JSON.stringify({
              digest: entry.digest,
              message: message.value.trim(),
            }),
            "application/json",
          ),
        );
        announce(`Appeal submitted for ${entry.namespace}.${entry.name}@${entry.version}.`);
        await refreshAppeals();
      } catch (error) {
        announce(String(error), true);
      }
    });
    li.append(form);
  }
  if (data.submissions.length === 0) item(list, "No submissions yet.");
}

async function refreshAppeals() {
  const data = await requestJson("/v1/publisher/appeals");
  const list = document.getElementById("appeals");
  list.replaceChildren();
  for (const entry of data.appeals) {
    item(
      list,
      `${entry.namespace}.${entry.name}@${entry.version}: ${entry.message}. ${entry.response ? `Reviewer response: ${entry.response}` : "Awaiting reviewer response."}`,
    );
  }
  if (!data.appeals.length) item(list, "No appeals yet.");
}

async function refreshReviewAppeals() {
  const data = await requestJson("/v1/review/appeals");
  const list = document.getElementById("review-appeals");
  list.replaceChildren();
  for (const entry of data.appeals) {
    const li = item(
      list,
      `${entry.namespace}.${entry.name}@${entry.version}: ${entry.status}. SHA-256 ${entry.digest}. Publisher: ${entry.message}. Original decision: ${entry.review_reason ?? "none"}.`,
    );
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = `Response to appeal ${entry.id} `;
    const response = document.createElement("textarea");
    response.required = true;
    response.maxLength = 4000;
    label.append(response);
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Send response";
    form.append(label, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await requestJson(
          `/v1/review/appeals/${entry.id}/response`,
          mutation("POST", JSON.stringify({ response: response.value.trim() }), "application/json"),
        );
        announce(`Response sent for appeal ${entry.id}.`);
        await refreshReviewAppeals();
      } catch (error) {
        announce(String(error), true);
      }
    });
    li.append(form);
  }
  if (!data.appeals.length) item(list, "No open appeals.");
}

async function refreshOperations() {
  const data = await requestJson("/v1/review/operations");
  const queue = data.queue;
  document.getElementById("queue-operations").textContent =
    `Worker heartbeat: ${queue.worker_recently_seen ? "recent" : "missing or stale"}. Last heartbeat: ${queue.last_worker_heartbeat_at ?? "none"}. Last completed scan: ${queue.last_scan_at ?? "none"}. ` +
    `Queued: ${queue.queued}. Scanning: ${queue.scanning}. Stale scans: ${queue.stale_scans}. Awaiting review: ${queue.awaiting_review}. ` +
    `Oldest queued: ${queue.oldest_queued_at ?? "none"}. Last review: ${queue.last_reviewed_at ?? "none"}.`;
  document.getElementById("signing-backlog").textContent =
    (queue.pending_signed_revocations
      ? `${queue.pending_signed_revocations} revoked version(s) still listed in published signed targets; publish updated TUF metadata promptly. `
      : "No revocations await signed publication. ") +
    `${queue.awaiting_signed_publication} approved version(s) await signed publication. ` +
    `Last signed publication: ${queue.last_signed_publication_at ?? "none"}.`;
  document.getElementById("metadata-freshness").textContent =
    "Stored TUF metadata expiry (advisory; this view does not verify signatures): " +
    data.metadataFreshness
      .map(
        (entry) =>
          `${entry.role}: ${entry.status}${entry.expiresAt ? ` at ${entry.expiresAt}` : ""}`,
      )
      .join("; ") +
    ". Refresh or publish signed metadata before a role expires.";
  const pending = document.getElementById("pending-revocations");
  pending.replaceChildren();
  for (const entry of data.pendingRevocations) {
    item(
      pending,
      `${entry.namespace}.${entry.name}@${entry.version}: SHA-256 ${entry.digest}. Revoked at ${entry.reviewed_at ?? "unknown"}.`,
    );
  }
  if (queue.pending_signed_revocations > data.pendingRevocations.length) {
    item(pending, "Only the oldest 100 pending revocations are shown.");
  }
}

async function refreshReview() {
  const data = await requestJson("/v1/review/queue");
  const list = document.getElementById("review-queue");
  list.replaceChildren();
  for (const entry of data.submissions) {
    const li = item(
      list,
      `${entry.namespace}.${entry.name}@${entry.version}: ${entry.status}. SHA-256 ${entry.digest}`,
    );
    const requested = document.createElement("p");
    requested.textContent = `Requested capabilities: ${listText(entry.manifest?.capabilities)}.`;
    li.append(requested);
    const comparison = document.createElement("p");
    const scan = entry.scan_result;
    const previous = scan?.comparisonVersion;
    comparison.textContent = !scan
      ? "Capability comparison pending scan."
      : scan.issues?.some((issue) => issue.code === "scan-failed")
        ? "Capability comparison unavailable because the scan failed."
        : !scan.capabilityChanges
          ? "Capability comparison unavailable for this scan."
          : previous
            ? `Compared with approved ${previous}: added ${listText(scan.capabilityChanges.added)}; removed ${listText(scan.capabilityChanges.removed)}.`
            : "No prior approved version for capability comparison.";
    li.append(comparison);
    li.append(reviewHistoryDisclosure(entry));
    if (scan?.dependencyAudit) {
      const audit = scan.dependencyAudit;
      const summary = document.createElement("p");
      const coverage =
        audit.status === "complete"
          ? `${audit.packagesChecked} exact npm versions checked.`
          : audit.status === "partial"
            ? `${audit.packagesChecked} exact npm versions checked; ${audit.packagesSkipped} entries could not be checked.`
            : audit.status === "not-declared"
              ? "No root npm lockfile was submitted; dependencies were not assessed."
              : audit.status === "unsupported"
                ? "The npm lockfile could not be audited."
                : "The advisory lookup was unavailable or incomplete.";
      summary.textContent = `Dependency advisory audit: ${coverage} ${audit.findings.length} known advisories found. A lockfile does not prove which code is in the bundle.`;
      li.append(summary);
      if (audit.findings.length) {
        const details = document.createElement("details");
        const heading = document.createElement("summary");
        heading.textContent = `Inspect ${audit.findings.length} dependency advisories`;
        details.append(heading);
        const findings = document.createElement("ul");
        for (const finding of audit.findings.slice(0, 50)) {
          const row = document.createElement("li");
          row.append(`${finding.name}@${finding.version}: `);
          const link = document.createElement("a");
          link.href = `https://osv.dev/vulnerability/${encodeURIComponent(finding.advisoryId)}`;
          link.textContent = finding.advisoryId;
          row.append(link);
          findings.append(row);
        }
        if (audit.findings.length > 50) {
          item(findings, `${audit.findings.length - 50} more in the raw scan result below.`);
        }
        details.append(findings);
        li.append(details);
      }
    }
    if (scan?.storageChanges) {
      const change = scan.storageChanges;
      const storage = document.createElement("p");
      const reviewNote =
        change.toVersion < change.fromVersion
          ? "Downgrade blocks approval."
          : change.toVersion === change.fromVersion
            ? "Storage definition changed without a schema version increase; inspect the manifest diff."
            : "Review declared migrations before approval.";
      storage.textContent = `Profile storage schema: version ${change.fromVersion} to ${change.toVersion}. ${reviewNote}`;
      li.append(storage);
      if (change.migrations?.length) {
        const migrations = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `Inspect declared storage migrations (${change.migrations.length} steps)`;
        migrations.append(summary);
        const steps = document.createElement("ul");
        for (const step of change.migrations) {
          item(
            steps,
            `Version ${step.from} to ${step.to}: ${step.renames.map((rename) => `${rename.from} to ${rename.to}`).join(", ")}`,
          );
        }
        migrations.append(steps);
        li.append(migrations);
      }
    }
    const files = entry.scan_result?.changes;
    if (files) {
      const fileChanges = document.createElement("p");
      fileChanges.textContent = `Package files: ${files.added?.length ?? 0} added, ${files.modified?.length ?? 0} modified, ${files.removed?.length ?? 0} removed.`;
      li.append(fileChanges);
    }
    if (scan?.reviewDiff) {
      const diff = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Inspect text changes (${scan.reviewDiff.entries.length} files${scan.reviewDiff.truncated ? ", preview truncated" : ""})`;
      diff.append(summary);
      for (const entry of scan.reviewDiff.entries) {
        const heading = document.createElement("h4");
        heading.textContent = `${entry.change}: ${entry.file}`;
        diff.append(heading);
        const preview = document.createElement("pre");
        preview.textContent =
          entry.patch ??
          `Preview omitted: ${entry.omitted}. Download the archive for full inspection.`;
        diff.append(preview);
      }
      li.append(diff);
    }
    const details = document.createElement("pre");
    details.textContent = JSON.stringify(
      { manifest: entry.manifest, scan: entry.scan_result },
      null,
      2,
    );
    li.append(details);
    const archive = document.createElement("a");
    archive.href = `/v1/review/${entry.namespace}/${entry.name}/${encodeURIComponent(entry.version)}/download`;
    archive.textContent = `Download ${entry.namespace}.${entry.name}@${entry.version} for inspection`;
    li.append(archive);
    if (entry.status !== "review") continue;
    const label = document.createElement("label");
    label.textContent = "Decision or rescan reason ";
    const reason = document.createElement("input");
    reason.required = true;
    reason.maxLength = 2000;
    label.append(reason);
    li.append(label);
    const rescan = document.createElement("button");
    rescan.type = "button";
    rescan.textContent = `Rescan ${entry.namespace}.${entry.name}@${entry.version}`;
    rescan.addEventListener("click", async () => {
      if (!reason.value.trim()) {
        announce("Enter a reason before requesting a rescan.", true);
        reason.focus();
        return;
      }
      rescan.disabled = true;
      try {
        await requestJson(
          `/v1/review/${entry.namespace}/${entry.name}/${encodeURIComponent(entry.version)}/rescan`,
          mutation(
            "POST",
            JSON.stringify({ digest: entry.digest, reason: reason.value.trim() }),
            "application/json",
          ),
        );
        announce(`${entry.namespace}.${entry.name}@${entry.version} queued for a new scan.`);
        await Promise.all([refreshReview(), refreshOperations()]);
      } catch (error) {
        announce(String(error), true);
        rescan.disabled = false;
      }
    });
    li.append(rescan);
    for (const action of ["approve", "reject"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${action === "approve" ? "Approve" : "Reject"} ${entry.namespace}.${entry.name}@${entry.version}`;
      button.addEventListener("click", async () => {
        if (!reason.value.trim()) {
          announce("Enter a reason before deciding.", true);
          reason.focus();
          return;
        }
        try {
          await requestJson(
            `/v1/review/${entry.namespace}/${entry.name}/${encodeURIComponent(entry.version)}`,
            mutation(
              "POST",
              JSON.stringify({
                action,
                digest: entry.digest,
                reason: reason.value.trim(),
              }),
              "application/json",
            ),
          );
          announce(
            `${entry.namespace}.${entry.name}@${entry.version} ${action === "approve" ? "approved" : "rejected"}.`,
          );
          await Promise.all([refreshReview(), refreshOperations()]);
        } catch (error) {
          announce(String(error), true);
        }
      });
      li.append(button);
    }
  }
  if (data.submissions.length === 0) item(list, "No submissions awaiting review.");
}

async function refreshApproved() {
  const data = await requestJson("/v1/review/approved");
  const list = document.getElementById("approved-versions");
  list.replaceChildren();
  for (const entry of data.versions) {
    const li = item(
      list,
      `${entry.namespace}.${entry.name}@${entry.version}. SHA-256 ${entry.digest}`,
    );
    const label = document.createElement("label");
    label.textContent = "Revocation reason ";
    const reason = document.createElement("input");
    reason.maxLength = 2000;
    label.append(reason);
    li.append(label);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Revoke ${entry.namespace}.${entry.name}@${entry.version}`;
    button.addEventListener("click", async () => {
      if (!reason.value.trim()) {
        announce("Enter a reason before revoking.", true);
        reason.focus();
        return;
      }
      try {
        await requestJson(
          `/v1/review/${entry.namespace}/${entry.name}/${encodeURIComponent(entry.version)}`,
          mutation(
            "POST",
            JSON.stringify({
              action: "revoke",
              digest: entry.digest,
              reason: reason.value.trim(),
            }),
            "application/json",
          ),
        );
        announce(`${entry.namespace}.${entry.name}@${entry.version} revoked.`);
        await Promise.all([refreshApproved(), refreshOperations()]);
      } catch (error) {
        announce(String(error), true);
      }
    });
    li.append(button);
  }
  if (data.versions.length === 0) item(list, "No approved versions.");
}

async function refreshBlockedDigests() {
  const data = await requestJson("/v1/review/blocked-digests");
  const list = document.getElementById("blocked-digests");
  list.replaceChildren();
  for (const entry of data.blockedDigests) {
    const li = item(list, `${entry.digest}: ${entry.reason}`);
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = `Reason to remove blocked digest ${entry.digest} `;
    const reason = document.createElement("input");
    reason.required = true;
    reason.maxLength = 2000;
    label.append(reason);
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = `Remove block for ${entry.digest}`;
    form.append(label, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await requestJson(
          `/v1/review/blocked-digests/${entry.digest}/remove`,
          mutation("POST", JSON.stringify({ reason: reason.value.trim() }), "application/json"),
        );
        announce(`Block removed for ${entry.digest}. Revoked versions remain revoked.`);
        await refreshBlockedDigests();
      } catch (error) {
        announce(String(error), true);
      }
    });
    li.append(form);
  }
  if (!data.blockedDigests.length) item(list, "No blocked digests.");
}

document.getElementById("namespace-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("namespace-name").value;
  try {
    await requestJson(
      "/v1/namespaces",
      mutation(
        "POST",
        JSON.stringify({ name, acceptTermsVersion: termsVersion }),
        "application/json",
      ),
    );
    announce(`Namespace ${name} created.`);
    await refreshNamespaces();
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const namespace = document.getElementById("member-namespace").value;
  const githubUserId = document.getElementById("member-user").value;
  const role = document.getElementById("member-role").value;
  try {
    await requestJson(
      `/v1/namespaces/${namespace}/members`,
      mutation("POST", JSON.stringify({ githubUserId, role }), "application/json"),
    );
    announce(`Invited GitHub user ${githubUserId} to ${namespace} as ${role}.`);
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const namespace = document.getElementById("upload-namespace").value;
  const name = document.getElementById("upload-name").value;
  const file = document.getElementById("upload-file").files[0];
  if (!file) return;
  try {
    const body = await requestJson(
      `/v1/publisher/${namespace}/${name}/versions`,
      mutation("POST", file, "application/octet-stream"),
    );
    announce(`Submitted ${namespace}.${name}@${body.version} for review. SHA-256 ${body.digest}.`);
    await refreshSubmissions();
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("verification-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const namespace = document.getElementById("verification-namespace").value;
  const verified = document.getElementById("verification-value").checked;
  const proofUrl = document.getElementById("verification-proof").value;
  const reason = document.getElementById("verification-reason").value;
  try {
    await requestJson(
      `/v1/review/namespaces/${namespace}/verification`,
      mutation("POST", JSON.stringify({ verified, proofUrl, reason }), "application/json"),
    );
    announce(`Namespace ${namespace} is now ${verified ? "verified" : "unverified"}.`);
    await refreshNamespaces();
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("blocked-digest-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const digest = document.getElementById("blocked-digest-value").value;
  const reason = document.getElementById("blocked-digest-reason").value;
  try {
    const result = await requestJson(
      "/v1/review/blocked-digests",
      mutation("POST", JSON.stringify({ digest, reason }), "application/json"),
    );
    announce(`Digest blocked. ${result.revoked} approved version(s) revoked.`);
    await Promise.all([refreshBlockedDigests(), refreshApproved(), refreshOperations()]);
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("blocked-digest-batch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("blocked-digest-batch-value");
  try {
    const body = parseBlockedDigestBatch(input.value);
    const result = await requestJson(
      "/v1/review/blocked-digests/batch",
      mutation("POST", body, "application/json"),
    );
    input.value = "";
    announce(`${result.blocked} digest(s) blocked. ${result.revoked} approved version(s) revoked.`);
    await Promise.all([refreshBlockedDigests(), refreshApproved(), refreshOperations()]);
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("refresh-submissions").addEventListener("click", () => {
  refreshSubmissions().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-invitations").addEventListener("click", () => {
  refreshInvitations().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-appeals").addEventListener("click", () => {
  refreshAppeals().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-review-appeals").addEventListener("click", () => {
  refreshReviewAppeals().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-review").addEventListener("click", () => {
  refreshReview().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-operations").addEventListener("click", () => {
  refreshOperations().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-approved").addEventListener("click", () => {
  refreshApproved().catch((error) => announce(String(error), true));
});
document.getElementById("refresh-blocked-digests").addEventListener("click", () => {
  refreshBlockedDigests().catch((error) => announce(String(error), true));
});
document.getElementById("logout").addEventListener("click", async () => {
  try {
    await fetch("/v1/logout", mutation("POST", "", "application/json"));
    location.reload();
  } catch (error) {
    announce(String(error), true);
  }
});

try {
  const me = await requestJson("/v1/me");
  document.getElementById(me ? "signed-in" : "signed-out").hidden = false;
  if (me) {
    publishingEnabled = me.publishingEnabled;
    termsVersion = me.termsVersion;
    document.getElementById("terms-version").textContent = termsVersion;
    document.getElementById("identity").textContent = `Signed in as ${me.login}.`;
    if (!me.publishingEnabled) {
      for (const form of ["namespace-form", "member-form", "upload-form"]) {
        for (const control of document.getElementById(form).elements) control.disabled = true;
      }
      announce(
        "Public publishing is disabled until publisher terms and security review are finalized.",
      );
    }
    document.getElementById("review-section").hidden = !me.admin;
    document.getElementById("revocation-section").hidden = !me.admin;
    document.getElementById("verification-section").hidden = !me.admin;
    document.getElementById("blocked-digests-section").hidden = !me.admin;
    await Promise.all([
      refreshNamespaces(),
      refreshInvitations(),
      refreshSubmissions(),
      refreshAppeals(),
      ...(me.admin
        ? [
            refreshReview(),
            refreshOperations(),
            refreshReviewAppeals(),
            refreshApproved(),
            refreshBlockedDigests(),
          ]
        : []),
    ]);
  }
} catch (error) {
  announce(String(error), true);
}
