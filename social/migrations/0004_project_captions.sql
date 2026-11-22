ALTER TABLE social_projects ADD COLUMN captions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(captions));
