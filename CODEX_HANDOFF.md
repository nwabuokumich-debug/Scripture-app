# Scripture App — Codex Handoff Document

## Current Status

- Repo branch: `main`
- Current cache/version values in repo:
  - `sw.js`: `const CACHE = 'scripture-v93'`
  - `index.html`: `app.js?v=85`
  - `index.html`: `style.css?v=94`
- Recent pushed commits on `main`:
  - `e9f7826` `Add hybrid reranking to Bible search`
  - `052f589` `Add semantic Bible search via pgvector + Transformers.js`
  - `ed5536d` `Use solid bg color for verse selection to remove overlap stripe`
  - `fc2a9a7` `Revert verse selection highlight to red`
  - `c4543ce` `Clean up multi-verse selection styling`
  - `74c36b2` `Update handoff with latest UI fixes`
  - `7bc224e` `Merge adjacent selected verse highlights`
  - `5dff138` `Soften verse selection highlight`
  - `a4486cc` `Tighten grouped verse spacing`
  - `8e1ff86` `Fix stack switcher clipping top stacks on mobile`

---

## ⚠️ Known Open Bug

**Semantic search returns wrong results on phone.** When the user searches on device, the RPC call returns 30 results but they are not semantically ordered — random genealogy verses appear instead of the expected match (e.g. "Now faith is the substance..." should return Hebrews 11:1 first). The same RPC call works correctly when tested with the Node service key. Suspected causes:

1. **Anon key vs service key** — the browser uses the anon key; the Node test used the service key. RLS on `verse_embeddings` allows public read, but double-check the policy is active in Supabase.
2. **Vector type casting via PostgREST** — supabase-js sends the embedding as a JSON array; PostgREST must cast it to `vector(384)`. If the cast silently fails and the vector is null/zero, all verses have equal cosine distance and Supabase returns arbitrary ordering.
3. **Transformers.js failing on mobile Safari** — if the in-browser embedding model fails to load and the code silently falls through, a null or garbage vector gets sent.

**Fix to try first:** In `app.js` `embedQueryVector()`, stringify the Float32Array as a PostgreSQL-style vector literal `'[0.1, 0.2, ...]'` before passing to `.rpc()`, instead of passing a raw JS array. PostgREST is more reliable with text-format vectors.

---

## Changes Made (since last handoff)

### Verse selection styling overhaul
- Replaced the old `border-radius: 4px` + `margin-top: -7px` overlap approach that caused a visible horizontal stripe between adjacent selected verses.
- `.verse-row.selected` now has `border-radius: 0` and a solid (non-alpha) background so the 6px row-overlap zone doesn't double-tint.
- Only `.selected-start` rounds top corners and `.selected-end` rounds bottom corners — the selection renders as one continuous block.
- Added a continuous `inset 2px 0 0` left accent bar across the whole selection.
- Light theme: `#fdeced` (selected), `#fce6e9` (action-active). Dark theme: `#2b191e` (selected), `#361c22` (action-active).

### Semantic Bible search (major feature)
- New file `migration-add-verse-embeddings.sql` — run once in Supabase SQL editor. Creates `pgvector` extension, `verse_embeddings` table (book_id, chapter, verse, `embedding vector(384)`), HNSW cosine index, and `search_verses_semantic(query_embedding, match_count, target_translation)` RPC. **Already applied to live Supabase project.**
- New file `embed-verses.js` — one-time Node job using `@xenova/transformers` (model: `Xenova/all-MiniLM-L6-v2`, 384-dim) to embed all 31,102 KJV verses and upsert into `verse_embeddings`. **Already run — all verses embedded.** Resumable (skips rows that already exist). Run with `SUPABASE_SERVICE_KEY=xxx node embed-verses.js`.
- `package.json` — added `@xenova/transformers: ^2.17.2` dependency.
- `app.js` `doSearch()` — completely rewritten. Reference parser still wins for direct lookups (e.g. "John 3:16" jumps to the verse). All other queries go through semantic search: Transformers.js is lazy-loaded in the browser the first time search opens (~25 MB one-time download, cached), the query is embedded locally (private, no API call), and `search_verses_semantic` RPC is called with the 384-dim vector. Results are returned in the active translation.
- Embeddings are KJV-only (translation-independent meaning). Results are always shown in whatever translation the user has active, via the RPC join on `verses`.

### Cache / deployment notes
- Always bump `index.html` `style.css?v=N` and `app.js?v=N` query strings AND `sw.js` `CACHE` name together whenever CSS or JS changes. Forgetting either means the phone serves stale files.
- GitHub Pages serves `index.html` with `Cache-Control: max-age=600` (10 min). If a change isn't showing on phone, the browser HTTP cache still has the old HTML. Wait 10 min or hard-refresh.

---

## Changes Made (pre-Claude, from original Codex handoff)

- Added a hard-press/long-press verse action mode in the Bible reader.
- Disabled native iOS text selection/callout on verse rows and compare sheet rows.
- Added compare support for multiple selected verses, grouped by translation.
- Added stack compare mode on cards via a dedicated Compare button.
- Converted the Bible reader to one grouped `.scripture-card` per chapter, with individual `.verse-row` elements inside it. Do not reintroduce per-verse cards unless explicitly requested.
- Tightened grouped verse spacing by reducing row padding and using slight negative row margins.
- Added selection grouping classes (`selected-start`, `selected-middle`, `selected-end`) so adjacent selected verses render as one continuous highlight.
- Fixed dark-mode contrast for the grouped reader card.
- Tightened stacked verse row spacing.
- Fixed the stack compare bar dismiss/clear behavior.
- Preserved stack and Bible scroll positions across phone sleep/app resume.
- Fixed the red verse highlight appearing on tap during scroll.
- Reworked the books sheet drag snap interaction (midpoint-based, not velocity).
- Fixed the reader settings panel becoming untappable on mobile.
- Added scroll-direction-based chrome hiding for both Bible and Stacks.
- Fixed chrome hide/show scroll jumps with overlay chrome and stable scroll padding.
- Added Supabase-backed stack sync via `user_stack_state` table.
- Added account sign-in/sign-up/sign-out UI.
- Added stack import/export controls.
- Added a stack switcher (vertical popup list).
- Added `San Francisco` as a selectable reader font.
- Reworked reader settings into a richer mobile sheet.
- Created this handoff document.

---

## What This App Is

A **Bible study PWA** (Progressive Web App) installable on iPhone/Android. Features:
- Multi-translation Bible reader (18 translations: KJV, BSB, WEB, AKJV, UKJV, MKJV, LITV, CPDV, Darby, Webster, DRA, YLT, ASV, BBE, NHEB, Jubilee, LEB, Rotherham)
- **Semantic search** — meaning-based, typo-tolerant, powered by in-browser Transformers.js + Supabase pgvector
- "Stacks" — user-created collections of saved verses (cached in localStorage, synced to Supabase when signed in)
- Greek word analysis for NT verses
- Compare translations side-by-side
- Reader settings: font, size, spacing, light/dark theme
- Account-based stack sync with Supabase Auth
- JSON import/export for stacks

---

## Credentials & Keys

> ⚠️ **The service key below has been committed to git history and should be rotated immediately at supabase.com → Project Settings → API.**

| Key | Value | Used In |
|-----|-------|---------|
| Supabase Project URL | Check `config.js` | `config.js`, all import scripts |
| Supabase Anon Key (public) | Check `config.js` | `config.js` — loaded by browser, safe to be public |
| Supabase Service Role Key (secret) | Check `import.js` | Hardcoded in old scripts — **ROTATE immediately** |

---

## Hosting

- Git remote: `https://github.com/nwabuokumich-debug/Scripture-app.git`, branch `main`
- Live URL: `https://nwabuokumich-debug.github.io/Scripture-app/`
- Deploy: push to `main` → GitHub Pages auto-deploys (usually 30–60s)
- `manifest.json` has `start_url` and `scope` set to `/Scripture-app/`

---

## Database (Supabase)

### Tables

**`books`** — `id` INTEGER PK (1–66), `name` TEXT, `testament` TEXT (`'old'`/`'new'`)

**`verses`** — `id` SERIAL PK, `book_id` → books, `chapter`, `verse`, `text`, `translation` (default `'kjv'`)

**`verse_embeddings`** *(new — already created and populated)*
- `book_id`, `chapter`, `verse` — composite PK
- `embedding vector(384)` — all-MiniLM-L6-v2 embedding of KJV verse text
- HNSW cosine index for fast similarity search
- RLS: public read enabled
- All 31,102 KJV verses are already embedded

**`nt_word_tags`** + **`strongs_lexicon`** — Greek data, may or may not exist

**`user_stack_state`** — `user_id` UUID PK, `stacks` JSONB, `updated_at` TIMESTAMPTZ; RLS per-user

### RPC functions
- `search_verses_semantic(query_embedding vector(384), match_count int, target_translation text)` — returns top N verses by cosine similarity, joined to `verses` and `books`. Grant to anon + authenticated.

### Indexes
```sql
idx_verses_location ON verses(book_id, chapter, verse, translation)
idx_verses_fts ON verses USING gin(to_tsvector('english', text))
idx_verses_translation ON verses(translation)
idx_verse_embeddings_hnsw ON verse_embeddings USING hnsw (embedding vector_cosine_ops)
```

---

## Import Scripts

All require `npm install` first. Run from repo root.

| Script | What It Imports | How to Run |
|--------|----------------|------------|
| `embed-verses.js` | Embeddings for all KJV verses into `verse_embeddings` | `SUPABASE_SERVICE_KEY=xxx node embed-verses.js` |
| `import-bsb.js` | BSB | `SUPABASE_SERVICE_KEY=xxx node import-bsb.js` |
| `import-modern.js` | AKJV, UKJV, LITV, MKJV, CPDV | `SUPABASE_SERVICE_KEY=xxx node import-modern.js` |
| `import-translations.js` | WEB, Darby, Webster, DRA, etc. | `SUPABASE_SERVICE_KEY=xxx node import-translations.js` |
| `stack-admin.js` | Admin CLI for user stacks | `SUPABASE_SERVICE_KEY=xxx node stack-admin.js check --email x` |

Scripts gitignored (contain hardcoded secrets): `import.js`, `import-greek.js`, `clear.js`, `clear-greek.js`

---

## File Structure

```
/
├── index.html              # App shell, all UI markup
├── app.js                  # All frontend logic
├── style.css               # All styles
├── config.js               # Supabase URL + anon key
├── sw.js                   # Service worker (network-first caching)
├── manifest.json           # PWA manifest
├── icon.svg                # App icon
├── schema.sql              # Initial DB setup
├── migration-add-translation.sql
├── migration-add-user-stack-state.sql
├── migration-add-verse-embeddings.sql  # pgvector + HNSW + RPC (already applied)
├── embed-verses.js         # One-time KJV embedding job (already run)
├── stack-admin.js          # Service-role stack admin CLI
├── import*.js              # Data import scripts
└── package.json            # Node deps (includes @xenova/transformers)
```

---

## Key Patterns in app.js

### Search (semantic)
- `preloadEmbedder()` — lazy-loads `Xenova/all-MiniLM-L6-v2` from jsDelivr CDN (~25MB, cached after first load). Called automatically when search sheet opens to warm the model in the background.
- `embedQueryVector(text)` — awaits the embedder and returns a 384-element float array.
- `doSearch()` — reference parser first (direct verse jump), then semantic: embed query → call `search_verses_semantic` RPC → render results in active translation.
- **Known bug:** results may not be semantically ordered on device. See "Known Open Bug" section above.

### State variables (top of file)
- `activeTranslation` — current translation slug, persisted in `localStorage`
- `TRANSLATIONS` — map of slug → display name for all 18 translations
- `selectedVerses` — array of selected verse objects for stacks/compare
- `appMode` — `'bible'` or `'stacks'`
- `activeStackId` — which stack is open
- `greekByVerse` — cached Greek word data for current chapter

### Stacks
- Local cache key: `study_stacks`
- Cloud table: `user_stack_state`
- Structure: `[{ id, title, verses: [{ passages: [{ ref, text }], note, addedAt }], createdAt, updatedAt }]`
- When signed in, remote stacks merged with local by `id`, newer `updatedAt` wins

### Verse selection classes (JS adds these)
- `selected` — base tinted background + left accent bar
- `selected-start` — top corners rounded (14px), extra top padding
- `selected-middle` — no rounding (between two consecutive selected verses)
- `selected-end` — bottom corners rounded (14px), extra bottom padding
- `action-active` — slightly stronger tint + stronger left bar (the verse long-pressed)

### Service Worker
- Network-first: always fetches fresh, falls back to cache only on network failure
- Cache name must be bumped in `sw.js` on every deploy
- Browser HTTP cache (max-age=600 from GH Pages) is the real cache to bust — change query strings in `index.html`

---

## Known Issues

1. **Semantic search wrong results on device** — see "Known Open Bug" above. Priority fix.
2. **Service key committed to git** — rotate at Supabase dashboard.
3. **Greek tables may not exist** — `nt_word_tags` and `strongs_lexicon` not in `schema.sql`.
4. **Cache busting is manual** — must bump `sw.js` CACHE + `index.html` query strings on every deploy.

---

## Tips for Codex

1. **Read app.js top-to-bottom once** — all logic is in one file. No framework.
2. **Translation picker** — slide-up sheet triggered by clicking translation label. Same trigger closes it.
3. **Books sheet** — dismisses via Cancel, backdrop tap, or drag-down (midpoint snap).
4. **Chrome hiding** — scroll-direction based for both Bible and Stacks.
5. **Greek analysis** — full-screen overlay `#greek-page`, NT only.
6. **Compare** — bottom sheet `#compare-backdrop`, groups verses by translation.
7. **Stack compare mode** — one card at a time, uses whole block unless specific passages selected.
8. **To add a new translation** — add slug/name to `TRANSLATIONS` in `app.js`, create import script, run it.
9. **To deploy** — push to `main`. Bump cache versions first (see Cache section).
10. **Auth for stacks** — Bible/Greek reads are public Supabase queries; stack sync needs Supabase Auth + `user_stack_state` table + RLS.
11. **localStorage keys** — `study_stacks`, `active_translation`, `reader_settings`, `scripture_scroll_state`.
12. **Bible reader layout** — one `.scripture-card` per chapter, `.verse-row` children. Do NOT reintroduce per-verse cards.
13. **Scroll resume** — preserves `bibleContent.scrollTop` and `stacksContent.scrollTop` on app resume. Don't call `renderStackView(..., { resetScroll: true })` on resume.
14. **Semantic search embeddings** — KJV-only, already in DB. The `verse_embeddings` table is keyed by (book_id, chapter, verse) — translation-agnostic. The RPC joins to whichever translation the user has active.
