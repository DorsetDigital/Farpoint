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
- Sends Slack notifications on first successful activation and meaningful state transitions.
- Keeps short-term raw checks plus compact hourly/daily reporting history and incidents.

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
GET    /api/v1/dashboard?page=1&per_page=25
GET    /api/v1/monitors
POST   /api/v1/monitors
GET    /api/v1/monitors/:id
PATCH  /api/v1/monitors/:id
DELETE /api/v1/monitors/:id
GET    /api/v1/monitors/:id/results?limit=50
GET    /api/v1/monitors/:id/stats?resolution=daily&days=365
GET    /api/v1/monitors/:id/incidents?days=365
~~~

`GET /health` is deliberately unauthenticated and reports only the health of the Farpoint Worker itself.


### Dashboard API

`GET /api/v1/dashboard` is intended for control-panel overview screens and returns a paginated monitor list, current status counts and time-based availability for 24 hours, 7 days and 30 days.

Supported query parameters:

~~~text
page=1
per_page=25            # 1-100
search=example         # matches monitor name or URL
state=DOWN             # UNKNOWN, UP, DEGRADED or DOWN
enabled=true           # true, false or all; defaults to true
sort=name              # name, state, response_time or last_checked
direction=asc          # asc or desc
~~~

The status summary covers the selected enabled population and is intentionally independent of the search/state filter, so the control panel can retain overall status counters while filtering the table.

Availability is calculated from incident duration rather than check counts, so fast confirmation retries and different monitoring intervals do not distort uptime percentages. A monitor's denominator starts at its own creation time when it has less history than the requested window. Degraded duration is reported separately and does not count as downtime.

Each dashboard monitor contains:

~~~text
id
name
url
enabled
state
interval_seconds
degraded_enabled
degraded_threshold_ms
last_checked_at
response_time_ms
status_code
error
availability.24h
availability.7d
availability.30d
~~~

Each availability window contains `uptime_percent`, `degraded_percent`, `down_ms`, `degraded_ms` and `observed_ms`.

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

A completely failed request is handled separately. While a failure is awaiting confirmation, Farpoint retries after 10 seconds rather than waiting for the normal monitoring interval. With the default failure confirmation count of 2, the second failed check can therefore confirm `DOWN` roughly 10 seconds after the first failure. Once downtime is confirmed, checks return to the normal monitoring interval.

Recovery uses the same fast-confirmation approach. When a `DOWN` monitor first succeeds, Farpoint retries after 10 seconds until the configured recovery confirmation count is reached. Once recovery is confirmed, the monitor returns to its normal cadence.

The first successful check also sends a one-off Slack confirmation — **Q-bot is watching** — so adding a monitor gives positive confirmation that Farpoint has actually checked it successfully.

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

## History and retention

Farpoint keeps detailed checks for a short window and compacts longer-term reporting data so a 12-month report does not require retaining every five-minute probe.

Default retention is:

~~~text
Raw checks        30 days
Hourly stats     365 days
Daily stats     1825 days (5 years)
Incidents       1825 days (5 years)
~~~

These are installation-level defaults, not hard-coded product assumptions. Override them in Worker configuration with:

~~~text
RAW_RETENTION_DAYS
HOURLY_RETENTION_DAYS
DAILY_RETENTION_DAYS
INCIDENT_RETENTION_DAYS
~~~

Each setting must be a positive number of days. Missing, invalid or non-positive values fall back to the documented defaults; Farpoint deliberately has no magic "0 means forever" value.

Hourly aggregates are updated as checks run. Once per day, each monitor rolls the completed day into a daily aggregate and applies retention cleanup. Open incidents are never removed by retention; the incident retention window applies only after an incident has ended.

For long-range reporting, use daily stats. Hourly stats are useful for shorter-term detail, while raw results remain available for diagnostics inside the raw retention window.

## Status

This repository is currently a proof of concept. The next useful steps are a real Cloudflare deployment, a small parallel pilot alongside the existing uptime service, and then control-panel integration.


## HTML dashboard

Farpoint includes a lightweight operator dashboard at:

~~~text
/dashboard
~~~

The prototype is deliberately self-contained HTML/CSS/JavaScript so the UI can be reused later inside the Silverstripe control panel.

For the standalone Farpoint version, enter the API key in the page. It is kept only in browser memory and is not persisted. The page refreshes every 10 seconds and supports search, state filtering, sorting and pagination.

The eventual Silverstripe integration should keep the same UI layer but replace the browser-side bearer-token fetch with a server-side proxy/controller, so the Farpoint API key never needs to be exposed to end users.
