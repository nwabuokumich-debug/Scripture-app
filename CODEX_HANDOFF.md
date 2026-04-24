# Scripture App — Codex Handoff Document

## Changes Made

- Added a hard-press/long-press verse action mode in the Bible reader so verses can expose actions without cluttering the reader UI.
- Disabled native iOS text selection/callout on verse rows so the custom hard-press action mode is not overridden by the system copy/lookup UI.
- Added compare support for multiple selected verses, grouped by translation, in the compare sheet.
- Added stack compare mode on cards via a dedicated Compare button, removed the old compare button from stack passage rows, and matched the new button styling to the other card actions.
- Tightened stacked verse row spacing so passages inside a stack visually match the normal reading layout more closely.
- Fixed the stack compare bar so it dismisses before the compare sheet opens and clears compare state when the sheet closes.
- Restored the reader verse layout after the long-press changes so the main reading experience stays usable.
- Preserved stack scroll position when reordering items so the list does not jump after drag/reorder actions.
- Fixed the red verse highlight appearing on tap during scroll by scoping hover styles to hover-capable devices and clearing verse action mode when the user scrolls.
- Removed the `Done` action from the books sheet header and left `Cancel`, backdrop tap, and drag dismissal as the close paths.
- Reworked the books sheet drag interaction so it snaps by midpoint: more than 50% open returns to the top, 50% or less open snaps down to dismiss.
- Smoothed and then slowed the books sheet open/close/snap animation so the motion feels less abrupt on mobile.
- Fixed the reader settings panel becoming untappable on mobile by rendering it above its backdrop at the document root.
- Added scroll-direction-based chrome hiding for both Bible reading and Stacks: downward reading scroll collapses the top controls and bottom nav, upward scroll reveals them again.
- Softened the hide-on-read behavior so the chrome waits for a longer scroll and eases out more gradually instead of disappearing too quickly.
- Tightened verse spacing in both the Bible reader and stack cards by reducing per-verse vertical padding and row gaps.
- Tightened verse spacing again in both the Bible reader and stack cards so adjacent verses sit even closer together.
- Added Supabase-backed stack sync via a new `user_stack_state` table, with local `study_stacks` kept as the on-device cache and migration source.
- Added account sign-in/sign-up/sign-out UI so stacks can sync across phone and laptop under one Supabase Auth user.
- Added stack import/export controls so users can back up current stacks to JSON and merge-import them later before or after sync rollout.
- Bumped the app asset cache versions in `index.html` and `sw.js` to force updated JS/CSS to load after changes.
- Created this handoff document to capture the current app state, setup notes, and known issues for Claude.

## What This App Is

A **Bible study PWA** (Progressive Web App) installable on iPhone/Android. Features:
- Multi-translation Bible reader (18 translations: KJV, BSB, WEB, AKJV, UKJV, MKJV, LITV, CPDV, Darby, Webster, DRA, YLT, ASV, BBE, NHEB, Jubilee, LEB, Rotherham)
- Search within the currently selected translation
- "Stacks" — user-created collections of saved verses and grouped passages (cached in localStorage, synced to Supabase when signed in)
- Greek word analysis for NT verses (word-by-word tagging + Strongs lexicon)
- Compare translations side-by-side for a verse, selected verses, or the active stack block
- Reader settings: font, size, spacing, light/dark theme
- Account-based stack sync with Supabase Auth
- JSON import/export for manual backup and restore of stacks

---

## Credentials & Keys

> ⚠️ **The service key below has been committed to git history and should be rotated immediately at supabase.com → Project Settings → API.**

| Key | Value | Used In |
|-----|-------|---------|
| Supabase Project URL | Check `config.js` | `config.js`, all import scripts |
| Supabase Anon Key (public) | Check `config.js` | `config.js` — loaded by browser, safe to be public |
| Supabase Service Role Key (secret) | Check `import.js`, `import-greek.js`, `clear.js`, `clear-greek.js` | Hardcoded in those scripts — **ROTATE immediately** |

The anon key is fine to be public (it's a "publishable" key). The service key bypasses RLS and should never be in frontend code or committed to git. Some Node import scripts use `SUPABASE_SERVICE_KEY` from the environment instead, but the secret is already committed in several scripts and should be rotated.

---

## Hosting

**TODO: Codex, provide these details:**
1. **Live URL + path**: Is the app deployed to `https://example.com/Scripture-app/` or `https://example.com/` or elsewhere?
2. **Supabase table status**: Which of these exist + have data?
   - `books` + `verses` (with `translation` column)?
   - `nt_word_tags` + `strongs_lexicon` (Greek data)?
3. **RLS policies**: Are public SELECT policies enabled on those tables?

**Current setup (from repo):**
- Git remote points to `https://github.com/nwabuokumich-debug/Scripture-app.git` and the current branch is `main`
- `manifest.json` is configured for the path `/Scripture-app/` via `start_url` and `scope`
- If the deployed path differs, update `manifest.json`
- The service worker cache name is `scripture-v72` in `sw.js` — bump when deploying, and keep the `style.css?v=75` / `app.js?v=74` query strings in `index.html` aligned with the current build

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

**`user_stack_state`**
- `user_id` UUID PRIMARY KEY → references `auth.users.id`
- `stacks` JSONB NOT NULL DEFAULT `[]`
- `updated_at` TIMESTAMPTZ NOT NULL
- Protected by RLS so each authenticated user can only read/write their own stack state
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

All scripts require `npm install` first (installs `@supabase/supabase-js`). Secret handling is mixed: `import.js`, `import-greek.js`, `clear.js`, and `clear-greek.js` hardcode the service key, while the other import scripts read `SUPABASE_SERVICE_KEY` from the environment.

| Script | What It Imports | How to Run |
|--------|----------------|------------|
| `import.js` | KJV — has service key hardcoded (old style) | `node import.js` |
| `import-bsb.js` | BSB (Berean Standard Bible) | `SUPABASE_SERVICE_KEY=xxx node import-bsb.js` |
| `import-modern.js` | AKJV, UKJV, LITV, MKJV, CPDV | `SUPABASE_SERVICE_KEY=xxx node import-modern.js` |
| `import-translations.js` | WEB, HNV, ERV, Darby, Webster, DRA, WNT (batch; can run one: `node import-translations.js web`) | `SUPABASE_SERVICE_KEY=xxx node import-translations.js` |
| `import-web-dra.js` | WEB and DRA (OSIS XML format — separate from above) | `SUPABASE_SERVICE_KEY=xxx node import-web-dra.js` |
| `import-greek.js` | NT Greek word tags + Strongs lexicon | `node import-greek.js` *(currently uses hardcoded secret)* |
| `stack-admin.js` | Service-role admin tool for checking/searching/listing/updating live user stacks | `SUPABASE_SERVICE_KEY=xxx node stack-admin.js check` |
| `clear.js` | Deletes all verses (use to re-import) | `node clear.js` *(currently uses hardcoded secret)* |
| `clear-greek.js` | Deletes Greek data | `node clear-greek.js` *(currently uses hardcoded secret)* |

Note: `import.js`, `import-greek.js`, `clear.js`, and `clear-greek.js` use a hardcoded service key. The other import/admin scripts read `SUPABASE_SERVICE_KEY` from the environment — safer.

Note: `import-translations.js` and `import-web-dra.js` overlap on WEB/DRA — they use different source formats (CSV vs OSIS XML). Don't run both for the same translation.

---

## File Structure

```
/
├── index.html              # App shell, all UI markup
├── app.js                  # All frontend logic (~2000 lines)
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
- `selectedVerses` — array of selected verse objects (`{ ref, book, chapter, verse, text }`) used for stacks/compare
- `appMode` — `'bible'` or `'stacks'`
- `activeStackId` — which stack is open
- `stackCompareMode`, `activeStackCompareIdx`, `stackCompareSelectedRefs` — active compare state for one stack card at a time
- `cardTranslations` — per-card translation override for stack cards
- `greekByVerse` — cached Greek word data for current chapter

### Supabase query patterns
- All verse fetches filter by `translation` column
- Greek data: queries `nt_word_tags` joined with `strongs_lexicon`
- Search uses `.ilike('text', '%query%')` — simple substring match, not full-text search (despite the `to_tsvector` index in the schema)
- Compare sheets group selected verses by translation, and stack compare uses the same renderer for one active stack block at a time

### Stacks
- Local cache key: `study_stacks`
- Cloud table: `user_stack_state`
- Structure: `[{ id, title, verses: [{ passages: [{ ref, text }], note, addedAt }], createdAt, updatedAt }]`
- Stack cards can hold one or more passages, and legacy single-verse cards are migrated on load
- `cardTranslations` keeps per-card translation overrides in memory only
- When signed in, remote stacks are merged with local cached stacks by `id`, newer `updatedAt` wins, and the merged result is pushed back to Supabase
- When signed out, the app falls back to local cached stacks only
- Export downloads the normalized stack JSON as a backup file
- Import accepts exported JSON and merges it into current stacks by `id`, with newer `updatedAt` winning

### Service Worker
- Cache name must be bumped manually in `sw.js` to force cache invalidation (`scripture-v71` at the moment)
- Network-first strategy: always tries fresh, falls back to cache

---

## Known Issues & Problems Encountered

### 1. Service key committed to git
`import.js`, `import-greek.js`, `clear.js`, and `clear-greek.js` hardcode the Supabase service role key. This secret is in git history. **Rotate the key at Supabase dashboard before doing anything else.**

### 2. Greek tables may not exist
The `nt_word_tags` and `strongs_lexicon` tables are referenced in `app.js` but their schema isn't in `schema.sql`. You'd need to check Supabase directly to see if they exist and are populated. If Greek word analysis is broken, these tables are the reason.

### 3. Translations removed from the UI
HNV, ERV, and WNT are not in the current `TRANSLATIONS` list in `app.js`, and `app.js` migrates users away from removed translation slugs.

However, `import-translations.js` still contains import logic for HNV, ERV, and WNT, so the repo does **not** prove why those translations were removed from the UI or whether their upstream source data was unusable.

### 4. Cache version must be bumped manually
`sw.js` line 1: `const CACHE = 'scripture-v73'` — increment this number after any deployment to bust the PWA cache on users' devices. Forgetting this means users get stale JS/CSS.

### 5. Browser cache-busting query strings
`index.html` loads `app.js?v=75` and `style.css?v=76` — these query strings bust browser cache. Increment them in `index.html` when deploying changes.

### 6. PWA path is hardcoded
`manifest.json` has `"start_url": "/Scripture-app/"` and `"scope": "/Scripture-app/"`. If the app ever moves to a different URL path, both values must be updated or the PWA install will break.

### 7. No build step
This is vanilla JS — no bundler, no TypeScript. `app.js` uses ES modules (`import` from CDN). The `node_modules` folder is only for the import scripts, not used by the browser app at all.

---

## Tips for Codex

1. **Read app.js top-to-bottom once** — all logic is in one file. State is at the top, DOM refs below that, then functions. There's no framework.

2. **Translation picker** is a slide-up sheet triggered by clicking the "KJV" label in the sidebar header. The animation uses CSS transitions + a small JS toggle.

   The books sheet now dismisses via `Cancel`, backdrop tap, or drag-down. Its snap logic is midpoint-based, not velocity-based.

   Bible reading and Stacks also use scroll-direction-based chrome hiding: reading downward collapses top/bottom chrome, and scrolling upward restores it.

3. **Greek analysis** opens as a full-screen overlay (`#greek-page`). It's only available for NT books when Greek data exists.

4. **Compare translations** is a bottom sheet modal (`#compare-backdrop`). It fetches all translations for a single verse in parallel and also groups selected verses by translation for multi-verse compare.

5. **Stack compare mode** is entered by tapping the Compare button on a stack card. Only one stack card can be active at a time, and `Compare` uses the whole block unless specific passages inside that card have been selected.

6. **To add a new translation**: add its slug/name to the `TRANSLATIONS` object in `app.js`, create an import script modeled after existing ones, and run it.

7. **To deploy**: the repo remote is GitHub and the current branch is `main`, but the deployment mechanism is not confirmed in this repo. If this is a GitHub Pages project site, the current manifest expects the app at `/Scripture-app/`.

8. **Auth now exists for stacks** — Bible/Greek reads are still public-read Supabase queries, but stack sync expects Supabase Auth plus the `user_stack_state` table + RLS. If the table is missing, the app still works locally and shows a sync issue state.

9. **localStorage keys used**:
   - `study_stacks` — local stack cache + migration source
   - `active_translation` — last used translation slug
   - `reader_settings` — single JSON blob with all reader prefs (theme, font, size, spacing)

10. **Reader settings panel** is moved to `document.body` at runtime in `app.js` so it stays above its transparent backdrop and remains tappable on iPhone.
