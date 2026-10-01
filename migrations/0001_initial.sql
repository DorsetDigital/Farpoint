CREATE TABLE monitors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    interval_seconds INTEGER NOT NULL DEFAULT 300,
    offset_seconds INTEGER NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 15000,
    expected_status INTEGER NOT NULL DEFAULT 200,
    min_body_bytes INTEGER NOT NULL DEFAULT 256,
    must_contain TEXT,
    must_not_contain TEXT,
    degraded_enabled INTEGER NOT NULL DEFAULT 0,
    degraded_threshold_ms INTEGER NOT NULL DEFAULT 3000,
    degraded_confirmation_checks INTEGER NOT NULL DEFAULT 2,
    failure_confirmation_checks INTEGER NOT NULL DEFAULT 2,
    recovery_confirmation_checks INTEGER NOT NULL DEFAULT 2,
    current_state TEXT NOT NULL DEFAULT 'UNKNOWN',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_slow INTEGER NOT NULL DEFAULT 0,
    consecutive_healthy INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    last_checked_at INTEGER,
    last_response_time_ms INTEGER,
    last_status_code INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE monitor_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    ok INTEGER NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER NOT NULL,
    error TEXT,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE INDEX idx_monitor_results_monitor_checked
    ON monitor_results (monitor_id, checked_at DESC);

CREATE INDEX idx_monitors_enabled
    ON monitors (enabled);
