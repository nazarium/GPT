CREATE TABLE social_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO social_meta VALUES ('initialized','0'), ('live','0');
CREATE TABLE social_locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE social_projects (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  fingerprint TEXT NOT NULL,
  ready_hash TEXT,
  selection TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(selection)),
  kind TEXT NOT NULL CHECK(kind IN ('archive','new')),
  queue_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  released_at INTEGER,
  first_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE social_slots (
  slot TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES social_projects(id)
);
CREATE TABLE social_publications (
  project_id TEXT NOT NULL REFERENCES social_projects(id),
  platform TEXT NOT NULL CHECK(platform IN ('instagram','facebook','tiktok')),
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
    ('pending','sending','retry','blocked','uncertain','scheduled','manual_required','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  buffer_id TEXT UNIQUE,
  external_url TEXT,
  payload TEXT,
  attempt_token TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, platform)
);
CREATE INDEX social_due ON social_publications(state,next_attempt);
CREATE TABLE social_events (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  platform TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX social_event_date ON social_events(created_at);
