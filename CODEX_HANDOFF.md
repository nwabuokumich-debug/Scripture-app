# Scripture App — Codex Handoff Document

## Current Status

- Repo branch: `main`
- **Uncommitted changes present** — not yet pushed (see below)
- Current cache/version values in staging:
  - `sw.js`: `const CACHE = 'scripture-v96'` (was v95)
  - `index.html`: `app.js?v=89` (was v88)
  - `index.html`: `style.css?v=97` (was v96)
  - `app.js` line 2: `import … from './voice.js?v=1'` — **4th cache-buster anchor** (new). `voice.js` is an ES module imported by app.js; its version lives in this import specifier, not index.html. Bump it whenever `voice.js` changes (and bump app.js's `?v=` too, since app.js text changes with it).
- Recent pushed commits on `main`:
  - `2726213` `Let strong semantic matches outrank shallow keyword hits`
  - `ef93a8e` `Allow smaller embedding upload batches`
  - `7338b4f` `Rank semantic search across translations`
  - `8f770be` `Support translation-specific verse embeddings`
  - `9ad598f` `Fetch phrase fragments for search candidates`
  - `424439c` `Boost phrase-aware search ranking`
  - `4555ef1` `Improve mobile search header layout`
  - `7f46988` `Fix semantic search vector RPC input`

---

## Scripture Voice Mode (new — uncommitted)

Hands-free, on-device text-to-speech for verses, selections, whole chapters, and Stack cards using the browser **Web Speech API** (`speechSynthesis`). 100% free — no ElevenLabs/OpenAI/external voice API. Architected so a paid provider can be swapped in later without touching the UI.

### Files
- **New `voice.js`** — the whole subsystem (dedicated module, imported by app.js):
  - `WebSpeechProvider` — the swap seam. Interface: `isSupported()`, `getVoices()`, `speakChunk(text,{voiceId,rate}) -> {promise,cancel}`, `pause()/resume()/cancel()`. A future `ElevenLabsProvider`/`OpenAIProvider` implements the same shape; swap one line, no UI changes.
  - `VoiceEngine` — provider-agnostic playlist + repeat (`none|verse|passage`) + repeat-delay + state machine (`idle|playing|paused`). Uses a **session token** (bumped on every stop/new-play) so stale async callbacks no-op; an **error-streak guard** prevents a tight loop if synthesis errors during Verse repeat; a `pause()/resume()` **heartbeat** keeps long utterances alive (Chrome/iOS ~15s cutoff) and is cleared on stop/pause/end; handles iOS flaky-pause (utterance ending mid-pause → resume advances instead of hanging).
  - `VoicePlayer` — a single persistent `#voice-bar` floating player (built once, handlers bound once → no listener/DOM leaks). Transport (⏮ ⏯ ⏹ ⏭) + chevron tray (speed stepper, voice `<select>`, repeat pills, delay stepper).
  - Persists `voice_settings` in localStorage (`{voiceId, rate, repeatMode, repeatDelayMs}`).
  - Exports `Voice` singleton + `initVoice({onItemStart,onStateChange})`.
- **`app.js`** — integration only (no voice logic): imports `Voice`/`initVoice`; `initVoice` wires the verse-highlight callback; **all Play UI is feature-gated on `Voice.isSupported`**. Play affordances added in 4 places: verse-action bar (`updateSelectionBar`), search results (`doSearch`), stack cards (`renderStackView`), chapter hero (`renderVerses`, "Listen" pill). `Voice.stopScripture()` called on navigation: `selectChapter`, `openBibleLocation`, `setMode` (mode change), `openStack` (different stack); translation change funnels through `selectChapter`, so it's covered.
- **`style.css`** — `.voice-bar` block (dark in both themes, mirrors `.selection-bar`) + tray controls; `.verse-speaking` now-playing highlight (reuses selection palette, dark variant); `.sel-actions-4` (verse-action 2×2 grid); `.result-play-btn`/`.result-actions`; `.reader-play-btn`; `.listen-card-btn` folded into the existing card-action selector groups (light + dark). Respects `prefers-reduced-motion`.

### Verification done (this session)
`node --check` (both JS files) ✓; headless Chrome boot — `#voice-bar` + all controls created, app boots ✓; Node engine-logic harness 12/12 (no-repeat, verse/passage repeat, stop, blank-skip, pause/resume incl. ended-while-paused, settings persistence + rate clamp) ✓. **Audio itself must be verified on-device (iPhone PWA)** — voices, native select, safe-area position, haptics.

### Known limitations
- iOS pauses TTS when the screen locks / tab backgrounds (platform constraint).
- Rate/voice changes apply to the **next** utterance, not the in-flight one (Web Speech can't retune a live utterance).
- "Repeat indefinitely" is realized as Verse/Passage looping until Stop (no fixed-count repeat was requested).

### Future ElevenLabs/OpenAI path
Implement a provider with the same interface (`speakChunk` fetches audio → plays via `Audio`/`AudioContext`). **Do NOT embed a paid key client-side** — proxy via `server.js` or a Supabase Edge Function. See the comment at the provider seam in `voice.js`.

---

## Uncommitted Work — Book Sheet Expansion / Local Dev Server

### Files Modified
- `app.js` — added expandable book list in sheet with inline chapter grid
- `index.html` — bumped cache-buster versions
- `style.css` — new styles for book expansion UI
- `sw.js` — bumped cache name to v95
- `package.json` — added `start` and `dev` scripts pointing to `server.js`
- `manifest.json` — changed `start_url` and `scope` from `/Scripture-app/` to `./` (relative path)

### New File
- `server.js` — simple local HTTP dev server for testing (network-first cache behavior locally)

### Changes in Detail

**app.js:**
- Added state: `bookChapterCounts` Map, `pendingChapterCountLoads` Set, `expandedBookId`
- `getBookChapterCount(book)` — new function to fetch max chapter for a translation on demand
- `openBookSheet()` — preserves `expandedBookId` when opening (for UX continuity)
- Translation picker now clears chapter count cache when switched (ensures fresh count per translation)
- `renderBookList()` — refactored to build expandable book items with inline chapter grid

**style.css:**
- New `.book-item-wrap`, `.book-item-caret`, `.book-chapter-grid`, `.book-chapter-btn`, `.book-chapter-loading` components
- Chapter buttons are circular, shadow-based, with active state highlighting
- Dark theme variants for all new components
- Book items now flex (label + caret) with space-between layout

**manifest.json:**
- Changed `start_url` and `scope` to relative paths (`./`) instead of GitHub Pages project path (`/Scripture-app/`)
- Allows app to work from any root domain (local dev, other hosting, etc.)

**server.js:**
- Minimal HTTP server for local testing
- Serves static files with `Cache-Control: no-store` (no caching) — good for dev
- Supports any relative URL path structure (will not work if app is deployed under a subpath again without reverting manifest)

### Rationale
- **Book expansion:** improved mobile UX — users can now see chapter counts inline before selecting a book, avoiding mid-flow lookups
- **Local server:** enables testing network-first service worker behavior and cache-busting without needing GitHub Pages or full build
- **Manifest change:** makes the app more portable and supports multiple deployment targets

### Cache-Busting Status ✓
All three cache-busting anchors have been incremented together (required by user memory):
- `index.html` style.css query string: v94 → v96
- `index.html` app.js query string: v85 → v88
- `sw.js` CACHE name: v93 → v95

**Important:** These changes are **not yet committed or pushed**. User tests on phone, so the app needs to be deployed (pushed to GitHub main) and cache cleared on mobile before testing new behavior.

---

## Current Search State

The original mobile semantic-search bug is no longer the best description of the system.

What is now true:

1. The app sends the query embedding as a pgvector literal string before calling Supabase RPC.
2. `verse_embeddings` is now translation-aware.
3. Live Supabase has both `kjv` and `bsb` embedding sets populated (`31,102` rows each).
4. The semantic RPC now ranks across available translation embeddings, then returns the verse text in the currently selected translation.
5. The final client-side merge/rank logic was adjusted so a genuinely strong semantic match can outrank shallow literal keyword overlap.

Verified example:

- Query: `Saul threw a spear at Jonathan`
- Expected verse: `1 Samuel 20:33`
- Raw semantic RPC now returns `1 Samuel 20:33` as result #1 for `target_translation='kjv'`
- Full local reproduction of the app ranking path also returns `1 Samuel 20:33` as result #1 after commit `2726213`

If the phone still shows older ordering, the most likely cause is stale client cache rather than stale database logic.

---

## Changes Made (since last handoff)

### Verse selection styling overhaul
- Replaced the old `border-radius: 4px` + `margin-top: -7px` overlap approach that caused a visible horizontal stripe between adjacent selected verses.
- `.verse-row.selected` now has `border-radius: 0` and a solid (non-alpha) background so the 6px row-overlap zone doesn't double-tint.
- Only `.selected-start` rounds top corners and `.selected-end` rounds bottom corners — the selection renders as one continuous block.
- Added a continuous `inset 2px 0 0` left accent bar across the whole selection.
- Light theme: `#fdeced` (selected), `#fce6e9` (action-active). Dark theme: `#2b191e` (selected), `#361c22` (action-active).

### Semantic Bible search (major feature)
- `migration-add-verse-embeddings.sql` now defines translation-aware embeddings and a semantic RPC that ranks across available translation embeddings, then returns the active translation text.
- New file `migration-translation-aware-embeddings.sql` — upgrade migration for existing Supabase projects that already had the old KJV-only embedding table.
- `embed-verses.js` now supports `TRANSLATION=<slug>` and resumable smaller upload batches via `BATCH_UPLOAD=<n>`.
- KJV embeddings are already in live Supabase.
- BSB embeddings were generated and uploaded to live Supabase during this session (`31,102` rows).
- `package.json` — added `@xenova/transformers: ^2.17.2` dependency.
- `app.js` `doSearch()` still embeds queries locally in the browser, but now sends the query vector as a pgvector literal string to the RPC.
- Results are still returned in the active translation, but the semantic rank can now be helped by other embedded translations such as BSB.
- `mergeAndRankSearchResults()` now includes phrase-aware boosts and a semantic-confidence boost so strong semantic hits are not buried by shallow keyword overlap.

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
- `translation`, `book_id`, `chapter`, `verse` — composite PK
- `embedding vector(384)` — all-MiniLM-L6-v2 embedding of verse text for that translation
- HNSW cosine index for fast similarity search
- RLS: public read enabled
- Live DB currently has:
  - `31,102` KJV embedding rows
  - `31,102` BSB embedding rows

**`nt_word_tags`** + **`strongs_lexicon`** — Greek data, may or may not exist

**`user_stack_state`** — `user_id` UUID PK, `stacks` JSONB, `updated_at` TIMESTAMPTZ; RLS per-user

### RPC functions
- `search_verses_semantic(query_embedding vector(384), match_count int, target_translation text)` — compares the query against available translation embeddings, groups by verse reference, keeps the best semantic distance per verse, and returns the verse text in `target_translation`. Grant to anon + authenticated.

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
| `embed-verses.js` | Embeddings for one translation into `verse_embeddings` | `SUPABASE_SERVICE_KEY=xxx TRANSLATION=bsb node embed-verses.js` |
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
├── app.js                  # All frontend logic (imports voice.js)
├── voice.js                # Scripture Voice Mode subsystem (Web Speech TTS, swappable provider)
├── style.css               # All styles
├── config.js               # Supabase URL + anon key
├── sw.js                   # Service worker (network-first caching)
├── manifest.json           # PWA manifest
├── icon.svg                # App icon
├── schema.sql              # Initial DB setup
├── migration-add-translation.sql
├── migration-add-user-stack-state.sql
├── migration-add-verse-embeddings.sql  # translation-aware pgvector + HNSW + RPC
├── migration-translation-aware-embeddings.sql  # upgrade migration for old DBs
├── embed-verses.js         # Per-translation embedding job (KJV + BSB already run live)
├── stack-admin.js          # Service-role stack admin CLI
├── import*.js              # Data import scripts
└── package.json            # Node deps (includes @xenova/transformers)
```

---

## Key Patterns in app.js

### Search (semantic)
- `preloadEmbedder()` — lazy-loads `Xenova/all-MiniLM-L6-v2` from jsDelivr CDN (~25MB, cached after first load). Called automatically when search sheet opens to warm the model in the background.
- `embedQueryVector(text)` — awaits the embedder and returns a 384-element float array.
- `doSearch()` — reference parser first (direct verse jump), then semantic: embed query → stringify as pgvector literal → call `search_verses_semantic` RPC → merge with keyword candidates → rerank → render results in active translation.
- `fetchKeywordCandidates()` — now also searches 3-word and 4-word phrase fragments so remembered Bible wording can get the right verse into the candidate pool before final ranking.
- `mergeAndRankSearchResults()` — now combines keyword score, semantic score, phrase score, hybrid bonus, and semantic-confidence boost.

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

1. **Client cache can mask fixes** — if phone results do not match verified local/Supabase behavior, stale `index.html` or service-worker cache is the first suspect.
2. **Service key committed to git** — rotate at Supabase dashboard.
3. **Greek tables may not exist** — `nt_word_tags` and `strongs_lexicon` not in `schema.sql`.
4. **Cache busting is manual** — must bump `sw.js` CACHE + `index.html` query strings on every deploy.

---

## Tips for Codex

1. **Read app.js top-to-bottom once** — all logic is in one file. No framework.
2. **Translation picker** — slide-up sheet triggered by clicking translation label. Same trigger closes it.
3. **Books sheet** — dismisses via Cancel, backdrop tap, or drag-down (midpoint snap). Now expandable per-book chapter grid.
4. **Chrome hiding** — scroll-direction based for both Bible and Stacks.
5. **Greek analysis** — full-screen overlay `#greek-page`, NT only.
6. **Compare** — bottom sheet `#compare-backdrop`, groups verses by translation.
7. **Stack compare mode** — one card at a time, uses whole block unless specific passages selected.
8. **To add a new translation** — add slug/name to `TRANSLATIONS` in `app.js`, create import script, run it.
9. **To deploy** — push to `main`. Bump cache versions first (see Cache section). **NOTE:** Uncommitted changes are ready; confirm with user before committing.
10. **Auth for stacks** — Bible/Greek reads are public Supabase queries; stack sync needs Supabase Auth + `user_stack_state` table + RLS.
11. **localStorage keys** — `study_stacks`, `active_translation`, `reader_settings`, `scripture_scroll_state`.
12. **Bible reader layout** — one `.scripture-card` per chapter, `.verse-row` children. Do NOT reintroduce per-verse cards.
13. **Scroll resume** — preserves `bibleContent.scrollTop` and `stacksContent.scrollTop` on app resume. Don't call `renderStackView(..., { resetScroll: true })` on resume.
14. **Semantic search embeddings** — no longer KJV-only. The live DB now has both KJV and BSB embeddings. The RPC ranks across available translation embeddings and then joins to whichever translation the user has active.
15. **Local dev server** — `npm run start` or `npm run dev` launches HTTP server on port 4173 (customizable via `PORT` env var). Good for testing cache behavior without GitHub Pages.
16. **Manifest deployment warning** — if app needs to be served under `/Scripture-app/` subpath again, revert `start_url` and `scope` in manifest.json and update any routing logic accordingly.
