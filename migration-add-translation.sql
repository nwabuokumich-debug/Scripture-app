-- Run this in Supabase SQL Editor to add translation support
-- Adds a 'translation' column to verses table, defaults existing data to 'kjv'

ALTER TABLE verses ADD COLUMN IF NOT EXISTS translation TEXT NOT NULL DEFAULT 'kjv';

-- Update index for fast lookups by translation
DROP INDEX IF EXISTS idx_verses_location;
CREATE INDEX idx_verses_location ON verses(book_id, chapter, verse, translation);

-- Update full-text search to include translation filter
DROP INDEX IF EXISTS idx_verses_fts;
CREATE INDEX idx_verses_fts ON verses USING gin(to_tsvector('english', text));
CREATE INDEX IF NOT EXISTS idx_verses_translation ON verses(translation);
