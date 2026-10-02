export function dashboardPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Farpoint Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5f7fa;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --up: #15803d;
      --up-bg: #dcfce7;
      --degraded: #b45309;
      --degraded-bg: #fef3c7;
      --down: #b91c1c;
      --down-bg: #fee2e2;
      --unknown: #475569;
      --unknown-bg: #e2e8f0;
      --accent: #2563eb;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --text: #e5e7eb;
        --muted: #94a3b8;
        --border: #273244;
        --up-bg: #123522;
        --degraded-bg: #3b2d0a;
        --down-bg: #3d1717;
        --unknown-bg: #263244;
      }
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .wrap { max-width: 1500px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 4px; font-size: 28px; }
    .subtitle { color: var(--muted); margin-bottom: 20px; }
    .toolbar, .filters, .cards {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: end;
    }
    .toolbar { justify-content: space-between; margin-bottom: 18px; }
    .auth { display: flex; gap: 8px; flex-wrap: wrap; }
    label { display: grid; gap: 5px; font-size: 13px; color: var(--muted); }
    input, select, button {
      font: inherit;
      border-radius: 7px;
      border: 1px solid var(--border);
      padding: 9px 11px;
      background: var(--panel);
      color: var(--text);
    }
    button { cursor: pointer; }
    button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    .cards { margin: 16px 0; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
      min-width: 135px;
    }
    .card strong { display: block; font-size: 28px; }
    .card span { color: var(--muted); font-size: 13px; }
    .table-wrap {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; min-width: 1050px; }
    th, td { padding: 12px 14px; border-bottom: 1px solid var(--border); text-align: left; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    tbody tr:last-child td { border-bottom: 0; }
    .name { font-weight: 650; }
    .url { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }
    .UP { color: var(--up); background: var(--up-bg); }
    .DEGRADED { color: var(--degraded); background: var(--degraded-bg); }
    .DOWN { color: var(--down); background: var(--down-bg); }
    .UNKNOWN { color: var(--unknown); background: var(--unknown-bg); }
    .muted { color: var(--muted); }
    .error { color: var(--down); white-space: pre-wrap; }
    .pager { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 12px; }
    .pager-actions { display: flex; gap: 8px; }
    .status-line { color: var(--muted); font-size: 13px; }
    @media (max-width: 700px) {
      .wrap { padding: 14px; }
      .toolbar { align-items: stretch; }
      .auth, .filters { display: grid; grid-template-columns: 1fr; width: 100%; }
      input, select, button { width: 100%; }
      .cards { display: grid; grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="wrap" id="farpoint-dashboard">
    <h1>Farpoint</h1>
    <div class="subtitle">Q is watching.</div>

    <div class="toolbar">
      <div class="auth">
        <label>API key
          <input id="api-key" type="password" autocomplete="off" placeholder="Bearer token">
        </label>
        <button id="connect" class="primary">Connect</button>
      </div>
      <div class="status-line" id="connection-status">Not connected</div>
    </div>

    <div class="filters">
      <label>Search
        <input id="search" type="search" placeholder="Name or URL">
      </label>
      <label>Status
        <select id="state">
          <option value="">All</option>
          <option>UP</option>
          <option>DEGRADED</option>
          <option>DOWN</option>
          <option>UNKNOWN</option>
        </select>
      </label>
      <label>Rows
        <select id="per-page">
          <option>25</option>
          <option selected>50</option>
          <option>100</option>
        </select>
      </label>
      <label>Sort
        <select id="sort">
          <option value="name">Name</option>
          <option value="state">Status</option>
          <option value="response_time">Response time</option>
          <option value="last_checked">Last checked</option>
        </select>
      </label>
      <button id="refresh">Refresh</button>
    </div>

    <div class="cards">
      <div class="card"><strong id="total">—</strong><span>Total</span></div>
      <div class="card"><strong id="up">—</strong><span>Up</span></div>
      <div class="card"><strong id="degraded">—</strong><span>Degraded</span></div>
      <div class="card"><strong id="down">—</strong><span>Down</span></div>
      <div class="card"><strong id="unknown">—</strong><span>Unknown</span></div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Status</th>
            <th>Response</th>
            <th>Last check</th>
            <th>24h uptime</th>
            <th>7d uptime</th>
            <th>30d uptime</th>
            <th>Degraded 24h</th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr><td colspan="8" class="muted">Enter an API key to load monitors.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <div id="page-info" class="status-line"></div>
      <div class="pager-actions">
        <button id="prev">Previous</button>
        <button id="next">Next</button>
      </div>
    </div>
  </div>

  <script>
    (() => {
      const root = document.getElementById("farpoint-dashboard");
      const byId = (id) => root.querySelector("#" + id);
      let apiKey = "";
      let page = 1;
      let pages = 1;
      let timer = null;

      const fmtPercent = (value) =>
        value == null ? "—" : Number(value).toFixed(value === 100 ? 0 : 2) + "%";

      const fmtMs = (value) =>
        value == null ? "—" : value >= 1000 ? (value / 1000).toFixed(2) + "s" : value + "ms";

      const fmtAge = (timestamp) => {
        if (!timestamp) return "Never";
        const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
        if (seconds < 60) return seconds + "s ago";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + "m ago";
        const hours = Math.floor(minutes / 60);
        return hours + "h ago";
      };

      const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

      async function load() {
        if (!apiKey) return;

        const params = new URLSearchParams({
          page: String(page),
          per_page: byId("per-page").value,
          sort: byId("sort").value,
          enabled: "true"
        });

        const search = byId("search").value.trim();
        const state = byId("state").value;
        if (search) params.set("search", search);
        if (state) params.set("state", state);

        byId("connection-status").textContent = "Refreshing…";

        try {
          const response = await fetch("/api/v1/dashboard?" + params.toString(), {
            headers: { Authorization: "Bearer " + apiKey },
            cache: "no-store"
          });

          if (!response.ok) {
            throw new Error("HTTP " + response.status + ": " + await response.text());
          }

          const data = await response.json();
          pages = Math.max(1, data.pagination.pages || 1);

          for (const key of ["total", "up", "degraded", "down", "unknown"]) {
            byId(key).textContent = data.summary[key];
          }

          byId("rows").innerHTML = data.monitors.length
            ? data.monitors.map((monitor) =>
              '<tr>' +
                '<td>' +
                  '<div class="name">' + escapeHtml(monitor.name) + '</div>' +
                  '<div class="url">' + escapeHtml(monitor.url) + '</div>' +
                '</td>' +
                '<td><span class="pill ' + monitor.state + '">' + monitor.state + '</span></td>' +
                '<td>' + fmtMs(monitor.response_time_ms) + '</td>' +
                '<td>' + fmtAge(monitor.last_checked_at) + '</td>' +
                '<td>' + fmtPercent(monitor.availability["24h"].uptime_percent) + '</td>' +
                '<td>' + fmtPercent(monitor.availability["7d"].uptime_percent) + '</td>' +
                '<td>' + fmtPercent(monitor.availability["30d"].uptime_percent) + '</td>' +
                '<td>' + fmtPercent(monitor.availability["24h"].degraded_percent) + '</td>' +
              '</tr>'
            ).join("")
            : '<tr><td colspan="8" class="muted">No monitors match these filters.</td></tr>';

          byId("page-info").textContent =
            "Page " + data.pagination.page + " of " + (data.pagination.pages || 1) +
            " · " + data.pagination.total + " matching monitors";
          byId("prev").disabled = page <= 1;
          byId("next").disabled = page >= pages;
          byId("connection-status").textContent =
            "Updated " + new Date(data.generated_at).toLocaleTimeString();
        } catch (error) {
          byId("connection-status").textContent = "Error";
          byId("rows").innerHTML =
            '<tr><td colspan="8" class="error">' + escapeHtml(error.message) + "</td></tr>";
        }
      }

      function reconnect() {
        apiKey = byId("api-key").value;
        page = 1;
        load();
        if (timer) clearInterval(timer);
        timer = setInterval(load, 10000);
      }

      byId("connect").addEventListener("click", reconnect);
      byId("refresh").addEventListener("click", load);
      byId("state").addEventListener("change", () => { page = 1; load(); });
      byId("per-page").addEventListener("change", () => { page = 1; load(); });
      byId("sort").addEventListener("change", () => { page = 1; load(); });

      let searchTimer = null;
      byId("search").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { page = 1; load(); }, 300);
      });

      byId("prev").addEventListener("click", () => {
        if (page > 1) { page--; load(); }
      });
      byId("next").addEventListener("click", () => {
        if (page < pages) { page++; load(); }
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
