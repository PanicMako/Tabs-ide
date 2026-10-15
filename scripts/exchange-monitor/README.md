# Exchange liveness monitor

A scheduled Cloudflare Worker requests `https://exchange.buildwithtabs.com/livez`
every ten minutes. It does not query Neon or storage, follow redirects, or read the
response body. Non-200 responses and network failures fail the scheduled invocation
and appear in Workers Logs. There is no public HTTP route or secret to configure.

Run with Node.js 22.18+ and the project's pinned cf CLI:

```sh
npm ci
npm test
npx cf deploy --dry-run
npx cf deploy
```

The Cloudflare account is selected by your cf login or `CLOUDFLARE_ACCOUNT_ID`.
For a new Cloudflare account, first open Workers & Pages in the dashboard to
initialize its free workers.dev subdomain; Cloudflare requires it even when the
Worker has no public HTTP route. No DNS or nameserver changes are needed for this Worker. To stop the pings, remove
the scheduled trigger from `cloudflare.config.ts` and redeploy with cf.

This reduces idle cold starts, but cannot prevent Render restarts or outages.
A continuously running Render service uses up to 744 of the workspace's 750 free
hours monthly. Other free services share that quota. The retired user-management
service was suspended before enabling this schedule. Check Render's Billing usage
page for hours already consumed this month; suspension does not refund them.

The schedule runs on Cloudflare, independently of developer laptops. Logs and
traces are enabled; this is a liveness check, not an alerting or database monitor.

## Deployment verification

Activated on 16 October 2026 after the account's workers.dev setup completed.
Worker version `f042ce5f-719f-42a7-a23c-a0f3ecb9be57` has its public route and
preview URLs disabled. Cloudflare recorded a real scheduled invocation at
01:10 IST on 16 October: `exchange_liveness`, HTTP 200, 354 ms, on the configured
ten-minute schedule. Logs and traces are enabled for future verification.
