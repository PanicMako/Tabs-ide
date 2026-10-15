import assert from "node:assert/strict";
import test from "node:test";
import { probe } from "./probe.mjs";

test("liveness check targets the public domain without following redirects or reading the body", async () => {
  let canceled = false;
  const result = await probe(async (url, options) => {
    assert.equal(url, "https://exchange.buildwithtabs.com/livez");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return {
      status: 200,
      body: {
        cancel: async () => {
          canceled = true;
        },
      },
    };
  });
  assert.equal(result.status, 200);
  assert.equal(canceled, true);
});

test("an unavailable backend is a failed probe, not a successful scheduled check", async () => {
  await assert.rejects(
    probe(async () => new Response(null, { status: 503 })),
    /HTTP 503/,
  );
});

test("transport failures remain visible to the scheduler", async () => {
  await assert.rejects(
    probe(async () => {
      throw new Error("TLS unavailable");
    }),
    /TLS unavailable/,
  );
});
