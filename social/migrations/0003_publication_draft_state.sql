-- Keep all delivery records and their IDs; add an explicit draft state.
CREATE TABLE social_publications_next (
 project_id TEXT NOT NULL REFERENCES social_projects(id),
 platform TEXT NOT NULL CHECK(platform IN ('instagram','facebook','tiktok')),
 channel_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
 ('pending','sending','retry','blocked','uncertain','scheduled','manual_required','sent','failed','draft')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 buffer_id TEXT UNIQUE,
 external_url TEXT,
 payload TEXT,
 attempt_token TEXT,
 error TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,platform)
);
INSERT INTO social_publications_next SELECT * FROM social_publications;
UPDATE social_publications_next SET state='draft'
 WHERE state IN ('blocked','manual_required')
 AND json_valid(payload) AND json_extract(payload,'$.saveToDraft')=1
 AND EXISTS(SELECT 1 FROM social_drafts d WHERE d.project_id=social_publications_next.project_id
 AND d.platform=social_publications_next.platform AND d.buffer_id=social_publications_next.buffer_id AND d.state='draft');
DROP TABLE social_publications;
ALTER TABLE social_publications_next RENAME TO social_publications;
CREATE INDEX social_due ON social_publications(state,next_attempt);
