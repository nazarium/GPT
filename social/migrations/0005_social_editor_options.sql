ALTER TABLE social_projects ADD COLUMN options TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(options));
