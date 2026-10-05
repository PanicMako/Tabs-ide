# Basic Tabs usage analytics

## Owner setup

1. Create a free account at https://posthog.com/signup and a project named **Tabs IDE**.
   Product Analytics currently includes 1,000,000 events per month free with no credit
   card required. Check https://posthog.com/pricing before enabling paid billing.
2. Choose US or EU hosting. Copy the project's **public ingestion key** (`phc_...`)
   from project settings. Do not share a personal API key or account credentials.
3. Set `key` in `apps/server/src/telemetry/ProjectConfig.ts` to that public project key.
   Set `host` to `https://us.i.posthog.com` or `https://eu.i.posthog.com` to match the
   project region. This source configuration is bundled into desktop releases so
   ordinary users do not need environment variables. The Tabs IDE US Cloud public
   key is now configured; builds with an empty key transmit nothing.
4. For local testing, `TABS_POSTHOG_KEY` and `TABS_POSTHOG_HOST` override the bundled
   values. Launch the actual Tabs process from that environment, rather than Finder.
5. Build and distribute a new desktop release. Existing published installers do not
   gain analytics retroactively. Keep the privacy document linked in release notes.
6. Verify two events in PostHog's activity feed: open Tabs, then interact with the
   foreground app or send an agent request. Confirm the random `distinct_id`, allowed
   metadata, `$process_person_profile=false`, and `$geoip_disable=true`. Repeated
   interactions on the same UTC day should not add more daily activity markers.
7. Turn off Settings > General > Privacy > Share basic usage analytics. Verify no
   new delivery after the preference takes effect, queued events are dropped, and
   the installation identifier is removed. Re-enable and verify a fresh identifier.

No browser SDK, automatic event capture, recordings, or LLM analytics is needed.
The local installation UUID is the only identity. Collection is best effort,
in-memory, bounded, and retried with backoff; network failures can undercount.
The daily markers keep normal volume to roughly two logical events per installation
per active day. Retries and relaunches can consume more ingestion volume even though
stable UUIDs deduplicate records. Keep paid billing disabled for a free-only setup.

## Pitch dashboard

Create a Product Analytics dashboard called **Tabs adoption** and save these insights:

| Chart                        | Event and calculation                                               | Meaning                                                                     |
| ---------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Daily active installations   | `tabs.installation.active`, unique users, daily interval            | Installations observed interacting or sending an agent request each UTC day |
| Weekly active installations  | Same event, unique users over the selected 7-day period             | Distinct installations active during that period                            |
| Monthly active installations | Same event, unique users over the selected 30-day period            | Distinct installations active during that period                            |
| New active installations     | Same event, first-ever occurrence                                   | Installations first observed using this analytics-enabled release           |
| Weekly retention             | Same event as start and return; first-ever start, weekly periods    | Percentage returning after their first observed active week                 |
| Release and OS adoption      | Same event, unique users, break down by `tabsVersion` or `platform` | Observed active installations by release or OS                              |

For a direct 30-day total in a PostHog SQL insight:

```sql
SELECT count(DISTINCT distinct_id) AS active_installations_30d
FROM events
WHERE event = 'tabs.installation.active'
  AND timestamp >= now() - INTERVAL 30 DAY
```

For new active installations, use the first-ever active-event timestamp per
`distinct_id`, rather than PostHog's identified-person lifecycle chart. Person
profiles are disabled, and lifecycle insights exclude anonymous events.
See https://posthog.com/docs/data/anonymous-vs-identified-events.

Use a whole-period unique-user calculation for the 7/30-day numbers. Do not sum
daily unique counts. Set the project timezone to UTC because timestamps are daily
UTC buckets. Do not interpret these events as exact launch/turn counts or precise
session times. The opened marker measures backend launch days; a backend left
running for several days can report later active days without another opened event.
Multiple clients connected to one server share one installation ID, and the app
kind describes the server rather than the connected device.

Recommended pitch wording: **“Tabs observed N active installations in the last
30 days, with R% returning the following week, measured since DATE.”** State the
measurement window and definition. The numbers exclude opt-outs and offline or
failed delivery, may count one person on multiple devices, and restart the identity
after opt-out/re-enable or deletion of local state. They cannot recover past usage,
establish exact human counts, or prove all downloads became active installations.

The Tabs IDE public ingestion key is configured for US Cloud. Dashboard creation
and checking stored events require the owner's PostHog account. Automated tests
explicitly override the bundled key with an empty or local-test key and never
send events to PostHog.

On October 5, 2026, the US ingestion endpoint accepted a manual
`tabs.analytics.connection_test` event (HTTP 200, status `Ok`). This separate
setup event is excluded from adoption insights, which select only
`tabs.installation.active` or `tabs.installation.opened`. Confirm the connection
check in the project's Activity feed; endpoint acceptance alone does not verify
visibility in the dashboard.

References: https://posthog.com/docs/product-analytics/trends/overview and
https://posthog.com/docs/product-analytics/retention.
