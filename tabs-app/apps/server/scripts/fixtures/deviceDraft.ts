import { createHash, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

type Profile = "Work" | "Personal";
const checklist = "/draft/guest-checkout-checklist";
const checklistId = "guest-checkout-checklist";
const checklistNotes = "Check guest checkout totals on both devices.";
const benchmarkReport = "/reports/benchmark";
const reportAttachment = "/reports/benchmark/attachment";
const reportExports = {
  selected: { title: "Selected rows", rows: ["Checkout,Passed"] },
  all: { title: "All reports", rows: ["Checkout,Passed", "Delivery,Needs review"] },
  archived: { title: "Archived", rows: ["Previous release,Archived"] },
} as const;

/** Disposable local web app. Work and Personal see separate drafts at identical URLs. */
export async function startDeviceDraftApp(port = 0, { variedCheckout = false } = {}) {
  type Draft = { profile: Profile; notes: string; images: Array<{ digest: string; png: Buffer }> };
  type Report = { filename: string; contents: Buffer; saves: number };
  const drafts = new Map<string, Draft>();
  const reports: Partial<Record<Profile, Report>> = {};
  const orders = { ios: new Set<string>(), android: new Set<string>() };
  const draftSaves = { Work: 0, Personal: 0 };
  const exportCounts = {
    Work: { selected: 0, all: 0, archived: 0 },
    Personal: { selected: 0, all: 0, archived: 0 },
  };
  const describeBytes = (bytes: Buffer) => ({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const reportSummary = (report: Report | undefined) =>
    report
      ? { filename: report.filename, saves: report.saves, ...describeBytes(report.contents) }
      : null;
  const trialCounts = () => {
    const draft = drafts.get(checklistId);
    return {
      orders: { ios: orders.ios.size, android: orders.android.size },
      draftSaves: { ...draftSaves },
      checkoutDraft: draft
        ? {
            path: checklist,
            profile: draft.profile,
            notesPreserved: draft.notes === checklistNotes,
            evidence: draft.images.map(({ png }) => describeBytes(png)),
          }
        : null,
      reportExports: { Work: { ...exportCounts.Work }, Personal: { ...exportCounts.Personal } },
      reportDrafts: {
        Work: reportSummary(reports.Work),
        Personal: reportSummary(reports.Personal),
      },
    };
  };
  const escapeHtml = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  function form(path: string, notes = "") {
    return `<form method="post" action="${path}" enctype="multipart/form-data">
      <label>QA notes <textarea name="notes">${escapeHtml(notes)}</textarea></label>
      <label>Device evidence <input id="evidence" type="file" name="evidence" accept="image/png" ${path === "/draft" ? "required" : ""}></label>
      <label>Comparison evidence (optional) <input id="comparison" type="file" name="comparison" accept="image/png"></label>
      <button>Save draft</button></form>`;
  }
  function redirect(response: ServerResponse, location: string) {
    response.writeHead(303, { Location: location });
    response.end();
  }
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const route = request.url?.split("?")[0];
    const checkout = /^\/checkout\/(ios|android)(?:\/(delivery|review|complete))?$/.exec(
      route ?? "",
    );
    if (checkout && checkout[2] === "complete" && request.method === "POST") {
      const platform = checkout[1] === "ios" ? "ios" : "android";
      const order = randomUUID();
      orders[platform].add(order);
      return redirect(response, `/checkout/${platform}/complete?order=${order}`);
    }
    if (request.method === "GET" && checkout) {
      const platform = checkout[1] === "ios" ? "ios" : "android";
      const stage = checkout[2];
      const order = new URL(request.url!, "http://127.0.0.1").searchParams.get("order");
      if (stage === "complete" && (!order || !orders[platform].has(order))) {
        response.writeHead(404).end("No matching demo order.");
        return;
      }
      const next = stage === undefined ? "delivery" : stage === "delivery" ? "review" : "complete";
      const sharedDeliveryControl = variedCheckout && stage === "delivery";
      const androidDelivery = sharedDeliveryControl && platform === "android";
      const label =
        stage === undefined
          ? "Checkout as guest"
          : stage === "delivery"
            ? androidDelivery
              ? "Review details"
              : "Continue"
            : "Place demo order";
      const total = stage === "review" && platform === "android" ? "$22.00" : "$20.00";
      const title =
        stage === undefined
          ? "Basket"
          : stage === "delivery"
            ? "Delivery"
            : stage === "review"
              ? "Review order"
              : "Order complete";
      const identifier = sharedDeliveryControl
        ? ` data-accessibility-identifier="${androidDelivery ? "com.android.chrome:id/" : ""}guest_checkout_review"`
        : "";
      const alignment = androidDelivery ? ' style="text-align: right"' : "";
      const navigation =
        stage === "complete"
          ? ""
          : `<form action="/checkout/${platform}/${next}"${stage === "review" ? ' method="post"' : ""}${alignment}><button${identifier}>${label}</button></form>`;
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${title}</title><h1>${title}</h1>
        ${stage === "complete" ? `<p>Demo order <code>${order}</code></p>` : ""}
        ${androidDelivery ? navigation : ""}
        <p id="checkout-total">Total: ${total}</p>
        ${
          stage === "review" && platform === "android"
            ? `<button type="button" onclick="document.getElementById('checkout-total').textContent='Total: $20.00'; this.disabled=true">Apply demo discount</button>`
            : ""
        }
        ${androidDelivery ? "" : navigation}`);
      return;
    }
    const profile = request.headers.cookie?.match(
      /(?:^|; )qa_profile=(Work|Personal)(?:;|$)/,
    )?.[1] as Profile | undefined;
    if (request.method === "GET" && (route === "/Work" || route === "/Personal")) {
      response.setHeader(
        "Set-Cookie",
        `qa_profile=${route.slice(1)}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return redirect(response, "/");
    }
    if (!profile) {
      response.writeHead(403);
      response.end("Choose the Work or Personal fixture profile.");
      return;
    }
    if (route === "/" && request.method === "GET") {
      response.end(`<!doctype html><title>QA drafts</title><h1>QA drafts</h1><p>${profile}</p>
        ${profile === "Work" ? `<a href="${checklist}">Guest checkout QA checklist</a>` : ""}
        <a href="/reports">Monthly QA report</a>
        ${form("/draft")}`);
      return;
    }
    if (route === reportAttachment && request.method === "GET") {
      const report = reports[profile];
      if (!report) return response.writeHead(404).end();
      return response
        .writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report.filename}"`,
        })
        .end(report.contents);
    }
    const benchmark = route === benchmarkReport;
    const position =
      benchmark || route === reportAttachment
        ? new URL(request.url!, "http://127.0.0.1").searchParams.get("position")
        : null;
    if (route === reportAttachment && request.method === "POST") {
      if (position !== "0" && position !== "1" && position !== "2")
        return response.writeHead(400).end("Choose benchmark position 0, 1 or 2.");
      let body = "";
      try {
        for await (const chunk of request) {
          body += String(chunk);
          if (body.length > 1024) return response.writeHead(413).end();
        }
      } catch {
        return;
      }
      const form = new URLSearchParams(body);
      const month = form.get("month")?.trim();
      let csv: string;
      try {
        csv = decodeURIComponent(form.get("csv") ?? "");
      } catch {
        return response.writeHead(400).end("Choose a report and reporting month.");
      }
      if (!month || !/^[A-Za-z0-9 ]{1,40}$/.test(month) || !csv)
        return response.writeHead(400).end("Choose a report and reporting month.");
      reports[profile] = {
        filename: `qa-report-${month}.csv`,
        contents: Buffer.from(csv),
        saves: (reports[profile]?.saves ?? 0) + 1,
      };
      return redirect(response, `${benchmarkReport}?position=${position}`);
    }
    if (benchmark && request.method === "POST") {
      const choice = new URL(request.url!, "http://127.0.0.1").searchParams.get("choice");
      if (choice !== "selected" && choice !== "all" && choice !== "archived") {
        response.writeHead(400).end("Choose a benchmark export.");
        return;
      }
      exportCounts[profile][choice]++;
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      response.end(["Area,Status", ...reportExports[choice].rows].join("\n"));
      return;
    }
    if ((route === "/reports" || benchmark) && request.method === "GET") {
      let controls = `<fieldset id="report-rows"><legend>Rows to export</legend>
          <label><input type="checkbox" value="Checkout,Passed" checked> Checkout</label>
          <label><input type="checkbox" value="Delivery,Needs review"> Delivery</label>
        </fieldset>
        <button id="export-selected">Export selected rows</button>`;
      if (benchmark) {
        if (position !== "0" && position !== "1" && position !== "2") {
          response.writeHead(400).end("Choose benchmark position 0, 1 or 2.");
          return;
        }
        const choices: Array<keyof typeof reportExports> = ["all", "archived"];
        choices.splice(Number(position), 0, "selected");
        controls = choices
          .map((choice) => {
            const { title } = reportExports[choice];
            return `<section aria-label="${title}"><h2>${title}</h2><button data-export="${choice}">Export</button></section>`;
          })
          .join("\n");
      }
      const saved = benchmark ? reports[profile] : undefined;
      const saveAction = benchmark
        ? ` method="post" action="${reportAttachment}?position=${position}"`
        : "";
      response.end(`<!doctype html><title>Monthly QA report</title><h1>Monthly QA report</h1><p>${profile}</p>
        ${controls}
        <form id="report-draft"${saveAction} hidden>
          <label>Reporting month <input id="report-month" name="month" required maxlength="40" pattern="[A-Za-z0-9 ]+"></label>
          ${benchmark ? '<input type="hidden" name="csv">' : ""}
          <button id="attach-report">Attach report to draft</button>
        </form>
        <section aria-label="Draft attachments">
          ${saved ? `<a id="attached-report" href="${reportAttachment}" download="${saved.filename}">${saved.filename}</a>` : '<a id="attached-report" hidden></a>'}
        </section>
        ${benchmark ? '<p role="status" id="export-status"></p>' : ""}
        <script>
          const draft = document.querySelector('#report-draft');
          const month = document.querySelector('#report-month');
          const attachment = document.querySelector('#attached-report');
          ${
            benchmark
              ? `const status = document.querySelector('#export-status');
          const csv = draft.elements.namedItem('csv');
          let lastExport = 0;
          document.querySelectorAll('[data-export]').forEach(button => {
            button.addEventListener('click', async () => {
              const attempt = ++lastExport;
              csv.value = '';
              draft.hidden = true;
              attachment.hidden = true;
              status.textContent = 'Exporting…';
              try {
                const response = await fetch('/reports/benchmark?choice=' + button.dataset.export, { method: 'POST' });
                if (!response.ok) throw new Error('Export failed');
                const contents = await response.text();
                if (attempt !== lastExport) return;
                // Native form submission normalizes line endings in field values.
                csv.value = encodeURIComponent(contents);
                draft.hidden = false;
                status.textContent = button.parentElement.ariaLabel + ' exported.';
              } catch {
                if (attempt === lastExport) status.textContent = 'Export failed. Try again.';
              }
            });
          });`
              : `let csv;
          document.querySelector('#export-selected').addEventListener('click', () => {
            const selected = [...document.querySelectorAll('#report-rows input:checked')];
            draft.hidden = selected.length === 0;
            csv = ['Area,Status', ...selected.map(row => row.value)].join('\\n');
          });
          draft.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!csv) return;
            const file = new File([csv], 'qa-report-' + month.value.trim() + '.csv', { type: 'text/csv' });
            if (attachment.href) URL.revokeObjectURL(attachment.href);
            attachment.href = URL.createObjectURL(file);
            attachment.download = file.name;
            attachment.textContent = file.name;
            attachment.hidden = false;
          });`
          }
        </script>`);
      return;
    }
    if (
      route === checklist &&
      request.method === "GET" &&
      profile === "Work" &&
      !drafts.has(checklistId)
    )
      drafts.set(checklistId, {
        profile,
        notes: checklistNotes,
        images: [],
      });
    const parts = /^\/draft\/([a-z0-9-]+)(?:\/evidence\/([a-f0-9]{64}))?$/.exec(route ?? "");
    const draft = parts ? drafts.get(parts[1]!) : undefined;
    if (parts && draft?.profile !== profile) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (parts?.[2] && request.method === "GET") {
      const image = draft?.images.find((i) => i.digest === parts[2]);
      if (!image) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" });
      response.end(image.png);
      return;
    }
    if ((route === "/draft" || (draft && !parts?.[2])) && request.method === "POST") {
      try {
        let length = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 21 * 1024 * 1024) {
            response.writeHead(413);
            response.end();
            return;
          }
          chunks.push(chunk);
        }
        const data = await new Response(Buffer.concat(chunks), {
          headers: {
            "Content-Type": request.headers["content-type"] ?? "",
          },
        }).formData();
        const files = [data.get("evidence")];
        const comparison = data.get("comparison");
        if (comparison && typeof comparison !== "string" && comparison.size) files.push(comparison);
        const images = [];
        for (const file of files) {
          if (draft && (!file || (typeof file !== "string" && !file.size))) continue;
          if (!file || typeof file === "string" || !file.size || file.type !== "image/png")
            throw new Error("PNG required");
          const png = Buffer.from(await file.arrayBuffer());
          if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
            throw new Error("PNG required");
          images.push({ digest: createHash("sha256").update(png).digest("hex"), png });
        }
        const id = parts?.[1] ?? randomUUID();
        const saved: Draft = draft ?? { profile, notes: "", images: [] };
        const notes = data.get("notes");
        if (typeof notes === "string") saved.notes = notes.slice(0, 8000);
        for (const image of images)
          if (!saved.images.some((i) => i.digest === image.digest)) saved.images.push(image);
        drafts.set(id, saved);
        draftSaves[profile]++;
        redirect(response, `/draft/${id}`);
      } catch {
        response.writeHead(400);
        response.end("Choose a PNG and retry.");
      }
      return;
    }
    if (request.method === "GET" && draft && route) {
      response.end(`<!doctype html><title>QA draft</title><meta name="tabs-screenshot-receipts" content="same-origin-png">
        <h1>${route === checklist ? "Guest checkout QA checklist" : "QA draft"}</h1>
        <p>${profile}</p>${draft.images
          .map(
            (image, index) => `<figure>
        <img width="240" alt="Device evidence ${index + 1}" src="${route}/evidence/${image.digest}">
        <figcaption>${image.png.length} bytes <code>${image.digest}</code></figcaption></figure>`,
          )
          .join("")}
        ${form(route, draft.notes)}`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener unavailable.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    drafts,
    trialCounts,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Check the agent-led trial while both profile routes are still available. */
export async function verifyCheckoutTrial(
  fixture: Awaited<ReturnType<typeof startDeviceDraftApp>>,
) {
  const { orders, draftSaves, checkoutDraft } = fixture.trialCounts();
  const errors: string[] = [];
  if (orders.ios !== 0 || orders.android !== 0)
    errors.push("Expected zero orders on both devices.");
  if (draftSaves.Work !== 1 || draftSaves.Personal !== 0)
    errors.push("Expected one Work draft save and zero Personal saves.");
  if (checkoutDraft?.profile !== "Work" || !checkoutDraft.notesPreserved)
    errors.push("The original Work checklist and notes must be present.");
  if (
    checkoutDraft?.evidence.length !== 2 ||
    new Set(checkoutDraft.evidence.map((image) => image.sha256)).size !== 2
  )
    errors.push("Expected two distinct screenshots in the Work checklist.");
  if (errors.length > 0 || !checkoutDraft) return { passed: false, errors };

  const cookieFor = async (profile: Profile) => {
    const response = await fetch(fixture.origin + "/" + profile, { redirect: "manual" });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (response.status !== 303 || !cookie) throw new Error("Could not open the fixture profile.");
    return cookie;
  };
  const [workCookie, personalCookie] = await Promise.all([
    cookieFor("Work"),
    cookieFor("Personal"),
  ]);
  const read = (path: string, cookie: string) =>
    fetch(fixture.origin + path, { headers: { cookie }, redirect: "manual" });

  const [workDraft, personalDraft] = await Promise.all([
    read(checkoutDraft.path, workCookie),
    read(checkoutDraft.path, personalCookie),
  ]);
  const workHtml = await workDraft.text();
  await personalDraft.text();
  if (workDraft.status !== 200 || !workHtml.includes(checklistNotes))
    errors.push("The Work draft could not be read with its original notes.");
  if (personalDraft.status !== 404) errors.push("Personal could read the Work draft.");

  const images = await Promise.all(
    checkoutDraft.evidence.map(async ({ bytes, sha256 }) => {
      const path = checkoutDraft.path + "/evidence/" + sha256;
      const [work, personal] = await Promise.all([
        read(path, workCookie),
        read(path, personalCookie),
      ]);
      const [body] = await Promise.all([work.arrayBuffer(), personal.arrayBuffer()]);
      const matches =
        work.status === 200 &&
        work.headers.get("content-type") === "image/png" &&
        workHtml.includes(`src="${path}"`) &&
        body.byteLength === bytes &&
        createHash("sha256").update(Buffer.from(body)).digest("hex") === sha256;
      return { sha256, matches, workStatus: work.status, personalStatus: personal.status };
    }),
  );
  if (images.some((image) => !image.matches))
    errors.push("A Work screenshot could not be verified.");
  if (images.some((image) => image.personalStatus !== 404))
    errors.push("Personal could read a Work screenshot.");
  return {
    passed: errors.length === 0,
    errors,
    draft: { workStatus: workDraft.status, personalStatus: personalDraft.status },
    images,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startDeviceDraftApp();
  const verify = process.argv.includes("--verify-checkout");
  console.log(
    `Open ${fixture.origin}/Work in the Work browser profile. Ctrl+C discards the drafts.`,
  );
  let closing = false;
  const closeTrial = async () => {
    if (closing) return;
    closing = true;
    try {
      const checkoutVerification = verify ? await verifyCheckoutTrial(fixture) : undefined;
      if (checkoutVerification && !checkoutVerification.passed) process.exitCode = 1;
      console.log(JSON.stringify({ ...fixture.trialCounts(), checkoutVerification }));
    } catch (error) {
      process.exitCode = 1;
      console.error(error);
    } finally {
      await fixture.close();
    }
  };
  process.once("SIGINT", closeTrial);
  process.once("SIGTERM", closeTrial);
}
