# Scripture App — Codex Handoff Document

## Changes Made

- Added a hard-press/long-press verse action mode so verses can expose actions without cluttering the reader UI.
- Restored the reader verse layout after the long-press changes so the main reading experience stays usable.
- Fixed the mobile verse card layout and adjusted styles around verse controls for smaller screens.
- Preserved stack scroll position when reordering items so the list does not jump after drag/reorder actions.
- Bumped the app asset cache versions in `index.html` and `sw.js` to force updated JS/CSS to load after changes.
- Created this handoff document to capture the current app state, setup notes, and known issues for Claude.
- Fixed red verse highlight appearing on tap during scroll (both light and dark mode). Root cause: mobile browsers keep `:hover` state after a tap; `--accent-light` in dark mode is `#2a1518` (dark red) making it very visible. Fix: wrapped `.verse-row:hover` styles in `@media (hover: hover)` so they only fire on mouse devices. Also added scroll-detection in the touchmove handler to clear `verseActionMode` if user scrolls.

## What This App Is

A **Bible study PWA** (Progressive Web App) installable on iPhone/Android. Features:
- Multi-translation Bible reader (18 translations: KJV, BSB, WEB, AKJV, UKJV, MKJV, LITV, CPDV, Darby, Webster, DRA, YLT, ASV, BBE, NHEB, Jubilee, LEB, Rotherham)
- Full-text search across translations
- "Stacks" — user-created collections of saved verses (stored in localStorage)
- Greek word analysis for NT verses (word-by-word tagging + Strongs lexicon)
- Compare translations side-by-side for any verse
- Reader settings: font, size, spacing, light/dark theme

---

## Credentials & Keys

> ⚠️ **The service key below has been committed to git history and should be rotated immediately at supabase.com → Project Settings → API.**

| Key | Value | Used In |
|-----|-------|---------|
| Supabase Project URL | Check `config.js` | `config.js`, all import scripts |
| Supabase Anon Key (public) | Check `config.js` | `config.js` — loaded by browser, safe to be public |
| Supabase Service Role Key (secret) | Check `import.js` | `import.js` and other import scripts — **ROTATE immediately** |

The anon key is fine to be public (it's a "publishable" key). The service key bypasses RLS and should never be in frontend code or committed to git.

---

## Hosting

**TODO: Codex, provide these details:**
1. **Live URL + path**: Is the app deployed to `https://example.com/Scripture-app/` or `https://example.com/` or elsewhere?
2. **Supabase table status**: Which of these exist + have data?
   - `books` + `verses` (with `translation` column)?
   - `nt_word_tags` + `strongs_lexicon` (Greek data)?
3. **RLS policies**: Are public SELECT policies enabled on those tables?

**Current setup (from code):**
- Must be served from the path `/Scripture-app/` — hard-coded in `manifest.json` (`start_url` and `scope`)
- If the actual hosting path differs, update `manifest.json`
- The service worker cache name is `scripture-v38` in `sw.js` — bump when deploying

---

## Database (Supabase)

### Tables

**`books`**
- `id` INTEGER PRIMARY KEY (1–66, matches canonical Bible book order)
- `name` TEXT
- `testament` TEXT — `'old'` or `'new'`

**`verses`**
- `id` SERIAL PRIMARY KEY
- `book_id` INTEGER → references `books.id`
- `chapter` INTEGER
- `verse` INTEGER
- `text` TEXT
- `translation` TEXT NOT NULL DEFAULT `'kjv'` (added via `migration-add-translation.sql`)

**`nt_word_tags`** *(Greek — may or may not exist yet)*
- Stores NT word-level Greek tagging data
- Imported via `import-greek.js`

**`strongs_lexicon`** *(Greek — may or may not exist yet)*
- Stores Strongs concordance entries
- Imported via `import-greek.js`

### Indexes
```sql
-- Fast verse lookup
idx_verses_location ON verses(book_id, chapter, verse, translation)
-- Full-text search
idx_verses_fts ON verses USING gin(to_tsvector('english', text))
-- Translation filter
idx_verses_translation ON verses(translation)
```

### To set up a fresh database:
1. Run `schema.sql` in Supabase SQL Editor (creates books + verses tables, inserts all 66 books)
2. Run `migration-add-translation.sql` (adds translation column + indexes)
3. Run import scripts for each translation (see below)

---

## Import Scripts

All scripts require `npm install` first (installs `@supabase/supabase-js`). Each script has the Supabase URL and service key hardcoded at the top — update them if you rotate keys.

| Script | What It Imports | How to Run |
|--------|----------------|------------|
| `import.js` | KJV — has service key hardcoded (old style) | `node import.js` |
| `import-bsb.js` | BSB (Berean Standard Bible) | `SUPABASE_SERVICE_KEY=xxx node import-bsb.js` |
| `import-modern.js` | AKJV, UKJV, LITV, MKJV, CPDV | `SUPABASE_SERVICE_KEY=xxx node import-modern.js` |
| `import-translations.js` | WEB, HNV, ERV, Darby, Webster, DRA, WNT (batch; can run one: `node import-translations.js web`) | `SUPABASE_SERVICE_KEY=xxx node import-translations.js` |
| `import-web-dra.js` | WEB and DRA (OSIS XML format — separate from above) | `SUPABASE_SERVICE_KEY=xxx node import-web-dra.js` |
| `import-greek.js` | NT Greek word tags + Strongs lexicon | `SUPABASE_SERVICE_KEY=xxx node import-greek.js` |
| `clear.js` | Deletes all verses (use to re-import) | `SUPABASE_SERVICE_KEY=xxx node clear.js` |
| `clear-greek.js` | Deletes Greek data | `SUPABASE_SERVICE_KEY=xxx node clear-greek.js` |

Note: `import.js` uses the hardcoded service key (old). All other scripts read the key from the `SUPABASE_SERVICE_KEY` environment variable — safer.

Note: `import-translations.js` and `import-web-dra.js` overlap on WEB/DRA — they use different source formats (CSV vs OSIS XML). Don't run both for the same translation.

---

## File Structure

```
/
├── index.html              # App shell, all UI markup
├── app.js                  # All frontend logic (~1800 lines)
├── style.css               # All styles
├── config.js               # Supabase URL + anon key (loaded by index.html)
├── sw.js                   # Service worker (network-first caching)
├── manifest.json           # PWA manifest
├── icon.svg                # App icon
├── schema.sql              # Initial DB setup
├── migration-add-translation.sql  # Adds translation column
├── import*.js              # Data import scripts (Node.js, not browser)
├── clear*.js               # Data deletion scripts
└── package.json            # Node deps for import scripts only
```

---

## Key Patterns in app.js

### State variables (top of file)
- `activeTranslation` — current translation slug (e.g. `'kjv'`), persisted in `localStorage`
- `TRANSLATIONS` — map of slug → display name for all 18 translations
- `selectedVerses` — array of verse IDs currently selected (for stacks/compare)
- `appMode` — `'bible'` or `'stacks'`
- `activeStackId` — which stack is open
- `greekByVerse` — cached Greek word data for current chapter

### Supabase query patterns
- All verse fetches filter by `translation` column
- Greek data: queries `nt_word_tags` joined with `strongs_lexicon`
- Search uses `.ilike('text', '%query%')` — simple substring match, not full-text search (despite the `to_tsvector` index in the schema)

### Stacks
- Stored entirely in `localStorage` as JSON
- Key: `study_stacks`
- Structure: `[{ id, name, verses: [{book, chapter, verse, text, ref}] }]`
- No server-side storage — stacks are device-local only

### Service Worker
- Cache name must be bumped manually in `sw.js` to force cache invalidation
- Network-first strategy: always tries fresh, falls back to cache

---

## Known Issues & Problems Encountered

### 1. Service key committed to git
The `import.js` (and other import scripts) have the Supabase service role key hardcoded. This is in git history. **Rotate the key at Supabase dashboard before doing anything else.**

### 2. Greek tables may not exist
The `nt_word_tags` and `strongs_lexicon` tables are referenced in `app.js` but their schema isn't in `schema.sql`. You'd need to check Supabase directly to see if they exist and are populated. If Greek word analysis is broken, these tables are the reason.

### 3. Translations that didn't work
Several translations were tried and removed because source data was unavailable or formats didn't match:
- HNV, ERV, WNT — removed (unavailable)
- The import scripts that remain are the ones that successfully loaded

### 4. Cache version must be bumped manually
`sw.js` line 1: `const CACHE = 'scripture-v38'` — increment this number after any deployment to bust the PWA cache on users' devices. Forgetting this means users get stale JS/CSS.

### 5. `app.js?v=45` versioning
`index.html` loads `app.js?v=45` and `style.css?v=44` — these query strings bust browser cache. Increment them in `index.html` when deploying changes.

### 6. PWA path is hardcoded
`manifest.json` has `"start_url": "/Scripture-app/"` and `"scope": "/Scripture-app/"`. If the app ever moves to a different URL path, both values must be updated or the PWA install will break.

### 7. No build step
This is vanilla JS — no bundler, no TypeScript. `app.js` uses ES modules (`import` from CDN). The `node_modules` folder is only for the import scripts, not used by the browser app at all.

---

## Tips for Codex

1. **Read app.js top-to-bottom once** — all logic is in one file. State is at the top, DOM refs below that, then functions. There's no framework.

2. **Translation picker** is a slide-up sheet triggered by clicking the "KJV" label in the sidebar header. The animation uses CSS transitions + a small JS toggle.

3. **Greek analysis** opens as a full-screen overlay (`#greek-page`). It's only available for NT books when Greek data exists.

4. **Compare translations** is a bottom sheet modal (`#compare-backdrop`). It fetches all translations for a single verse in parallel.

5. **To add a new translation**: add its slug/name to the `TRANSLATIONS` object in `app.js`, create an import script modeled after existing ones, and run it.

6. **To deploy**: push to the GitHub repo connected to GitHub Pages. The app serves from the `main` branch root.

7. **No auth** — the app is fully public read-only. Supabase RLS should be set to allow public SELECT on `books`, `verses`, `nt_word_tags`, `strongs_lexicon`. No user accounts.

8. **localStorage keys used**:
   - `study_stacks` — saved stacks (JSON array)
   - `active_translation` — last used translation slug
   - `reader_settings` — single JSON blob with all reader prefs (theme, font, size, spacing)
