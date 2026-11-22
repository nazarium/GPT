CREATE TABLE social_drafts (
  project_id TEXT NOT NULL REFERENCES social_projects(id),
  platform TEXT NOT NULL CHECK(platform IN ('instagram','facebook','tiktok')),
  channel_id TEXT,
  buffer_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('saving','draft','uncertain','blocked')),
  payload TEXT,
  due_at TEXT,
  fingerprint TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,platform)
);
INSERT OR IGNORE INTO social_drafts(project_id,platform,buffer_id,state,due_at,fingerprint,updated_at)
SELECT project_id,platform,json_extract(detail,'$.bufferId'),'draft',
 json_extract(detail,'$.dueAt'),COALESCE(json_extract(detail,'$.fingerprint'),''),created_at
FROM social_events WHERE event='buffer_draft_created' AND json_valid(detail)
ORDER BY id DESC;
