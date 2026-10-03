CREATE TABLE monitor_hourly_stats (
    monitor_id TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    checks INTEGER NOT NULL DEFAULT 0,
    up_checks INTEGER NOT NULL DEFAULT 0,
    degraded_checks INTEGER NOT NULL DEFAULT 0,
    down_checks INTEGER NOT NULL DEFAULT 0,
    response_time_sum_ms INTEGER NOT NULL DEFAULT 0,
    response_time_min_ms INTEGER,
    response_time_max_ms INTEGER,
    PRIMARY KEY (monitor_id, period_start),
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE TABLE monitor_daily_stats (
    monitor_id TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    checks INTEGER NOT NULL DEFAULT 0,
    up_checks INTEGER NOT NULL DEFAULT 0,
    degraded_checks INTEGER NOT NULL DEFAULT 0,
    down_checks INTEGER NOT NULL DEFAULT 0,
    response_time_sum_ms INTEGER NOT NULL DEFAULT 0,
    response_time_min_ms INTEGER,
    response_time_max_ms INTEGER,
    PRIMARY KEY (monitor_id, period_start),
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE TABLE monitor_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('DEGRADED', 'DOWN')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE INDEX idx_hourly_stats_period
    ON monitor_hourly_stats (monitor_id, period_start DESC);

CREATE INDEX idx_daily_stats_period
    ON monitor_daily_stats (monitor_id, period_start DESC);

CREATE INDEX idx_monitor_incidents_started
    ON monitor_incidents (monitor_id, started_at DESC);

CREATE UNIQUE INDEX idx_monitor_incidents_open
    ON monitor_incidents (monitor_id)
    WHERE ended_at IS NULL;
