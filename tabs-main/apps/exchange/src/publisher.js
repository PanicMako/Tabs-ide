const status = document.getElementById("status");

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

async function refreshNamespaces() {
  const data = await requestJson("/v1/publisher/namespaces");
  const list = document.getElementById("namespaces");
  list.replaceChildren();
  for (const namespace of data.namespaces) {
    item(
      list,
      `${namespace.name} (${namespace.role}${namespace.verified ? ", verified" : ", unverified"})`,
    );
  }
  if (data.namespaces.length === 0) item(list, "No namespaces yet.");
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
    label.textContent = "Decision reason ";
    const reason = document.createElement("input");
    reason.required = true;
    reason.maxLength = 2000;
    label.append(reason);
    li.append(label);
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
          await refreshReview();
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
        await refreshApproved();
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
        JSON.stringify({ name, acceptTermsVersion: "2026-09-24" }),
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
    announce(`Added GitHub user ${githubUserId} to ${namespace} as ${role}.`);
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
    await Promise.all([refreshBlockedDigests(), refreshApproved()]);
  } catch (error) {
    announce(String(error), true);
  }
});

document.getElementById("refresh-submissions").addEventListener("click", () => {
  refreshSubmissions().catch((error) => announce(String(error), true));
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
      refreshSubmissions(),
      refreshAppeals(),
      ...(me.admin
        ? [refreshReview(), refreshReviewAppeals(), refreshApproved(), refreshBlockedDigests()]
        : []),
    ]);
  }
} catch (error) {
  announce(String(error), true);
}
