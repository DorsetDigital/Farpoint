# Farpoint

Farpoint is a small, external uptime and performance monitor designed to integrate with a hosting platform.

It runs on Cloudflare Workers, so the monitor is independent of the infrastructure it is watching. Each site is checked with a real HTTP GET of the public page and Farpoint records both availability and the time taken to receive the HTML response body.

## What the first PoC does

- Creates, updates and removes monitors through an authenticated HTTP API.
- Uses one SQLite-backed Durable Object per monitor for independent scheduling.
- Gives each monitor a stable random 0–59 second offset, so checks are spread through the minute rather than firing together.
- Uses D1 for monitor configuration and check history.
- Performs a visitor-facing GET, follows redirects and reads the response body.
- Supports expected HTTP status, minimum body size, required text and forbidden text checks.
- Tracks **UP**, **DEGRADED** and **DOWN** states.
- Makes degraded monitoring optional per site with a configurable response-time threshold.
- Confirms failures, degradation and recovery before changing state.
- Sends Slack notifications only on meaningful state transitions.

## Requirements

- Node.js 20 or newer
- A Cloudflare account
- A Slack incoming webhook for notifications

The design is intentionally compatible with the Cloudflare Free plan for development and an initial pilot.

## Local setup

~~~bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
~~~

Set a local API key and, optionally, a Slack webhook in `.dev.vars`.

## Create a monitor

~~~bash
curl -X POST http://localhost:8787/api/v1/monitors \
  -H 'Authorization: Bearer replace-me' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Example Website",
    "url": "https://example.com/",
    "interval_seconds": 300,
    "timeout_ms": 15000,
    "expected_status": 200,
    "min_body_bytes": 256,
    "degraded": {
      "enabled": true,
      "threshold_ms": 3000,
      "confirmation_checks": 2
    },
    "failure_confirmation_checks": 2,
    "recovery_confirmation_checks": 2
  }'
~~~

The stable scheduling offset is assigned by Farpoint and returned with the monitor.

For a five-minute monitor with an offset of 22 seconds, checks occur at times such as:

~~~text
12:00:22
12:05:22
12:10:22
12:15:22
~~~

## API

All `/api/v1/*` routes require:

~~~text
Authorization: Bearer <API_KEY>
~~~

Routes:

~~~text
GET    /api/v1/monitors
POST   /api/v1/monitors
GET    /api/v1/monitors/:id
PATCH  /api/v1/monitors/:id
DELETE /api/v1/monitors/:id
GET    /api/v1/monitors/:id/results?limit=50
~~~

`GET /health` is deliberately unauthenticated and reports only the health of the Farpoint Worker itself.

## Optional content checks

A monitor can check more than the status code:

~~~json
{
  "min_body_bytes": 5000,
  "must_contain": ["</html>"],
  "must_not_contain": [
    "Service Unavailable",
    "There has been an error"
  ]
}
~~~

These checks operate on the returned HTML, not on a separate application health endpoint.

## Degraded monitoring

Degraded monitoring is opt-in:

~~~json
{
  "degraded": {
    "enabled": true,
    "threshold_ms": 3000,
    "confirmation_checks": 2
  }
}
~~~

Two consecutive HTML responses taking longer than three seconds would transition the site from `UP` to `DEGRADED` and send an orange Slack warning.

A completely failed request is handled separately and transitions to `DOWN` after the configured failure confirmation count.

## Cloudflare deployment

The D1 binding intentionally omits a database ID. Wrangler can provision the D1 resource during the first deployment and write the generated ID into the local configuration.

Set production secrets before enabling real monitors:

~~~bash
npx wrangler secret put API_KEY
npx wrangler secret put SLACK_WEBHOOK_URL
~~~

Then deploy and apply the D1 migration:

~~~bash
npm run deploy
npm run db:migrate:remote
~~~

Run the checks locally before deployment:

~~~bash
npm run check
~~~

## Design notes

Durable Object alarms are used instead of a single cron fan-out. Each monitor owns its next check time and reschedules itself after execution.

The D1 database is the shared source of truth for configuration, current state and recent check results. Durable Object storage only needs to retain the monitor ID and its next alarm.

Slack failures are logged but do not prevent the monitoring schedule from continuing.

## Status

This repository is currently a proof of concept. The next useful steps are a real Cloudflare deployment, a small parallel pilot alongside the existing uptime service, and then control-panel integration.
