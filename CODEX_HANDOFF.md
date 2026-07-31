# Scripture App — Handoff Document

_Last updated: 2026-07-31_

---

## Current Status (read this first)

- Repo branch: `main`. **145 commits.** Last commit `12bbfde` (2026-06-17).
- **There is ~6 weeks of uncommitted, unpushed work in the tree.** Last commit was June 17; today is July 31. Nothing since June has reached the user's phone.
- The active problem is **voice quality**, not voice plumbing. Playback works; it sounds mechanical.

### Uncommitted changes in the working tree

A **redesign of the expanded Voice Mode player** — appears complete, never verified on device:

| File | Change |
|---|---|
| `voice.js` | Restructured expanded panel: new `.voice-header` (reference + minimize chevron), centered `.voice-transport` (⏮ / big play / ⏭), settings tray now **always visible** (the ⚙ `.voice-tray-toggle` and its handler were deleted), full-width **"Stop reading"** button at the bottom. |
| `style.css` | 68px accent play button with glow shadow, 54px transparent prev/next, mini compact row hidden while expanded. |
| `index.html` | `style.css?v=103` → `104` |
| `sw.js` | `scripture-v105` → `v106` |
| `app.js` | `./voice.js?v=9` → `?v=10` |

**⚠️ Cache-buster gap:** `app.js?v=96` in `index.html:262` was **not** bumped, but `app.js` text *did* change (the import line). Bump it to `97` before pushing or phones will serve the old `app.js` and keep importing `voice.js?v=9`.

Untracked scratch files (not part of any feature): `__voice-preview.html` (standalone harness for eyeballing the voice bar without booting the app), `tmp-diligence-search.mjs` (one-off Supabase scan for diligence/sloth/idleness verses).

---

## Project Timeline

### Phase 1 — Foundation (2026-03-29 → 03-30)
Initial PWA shell, GitHub Pages deployment, service-worker path wars (added → removed → self-destructing → network-first). Mobile sizing, touch targets, safe areas. Sidebar interaction. Long-press drag-to-reorder for stack cards — rewritten four times before landing on a transform-based animation.

### Phase 2 — Stacks & multi-verse (2026-04-01)
Multi-verse selections stored as **separate passages** rather than one text blob, with an auto-migration for old cards. Stack card verse layout matched to the Bible reader.

### Phase 3 — Translations & compare (2026-04-07 → 04-09)
Grew from KJV-only to **18 translations** (BSB, YLT, ASV, BBE, NHEB, Jubilee, LEB, Rotherham, WEB, Darby, Webster, DRA, AKJV, UKJV, LITV, MKJV, CPDV). Dropdown translation picker replaced tap-to-cycle. Compare-translations feature, then stack block compare. Spring animations on all sheets.

### Phase 4 — Reader interaction (2026-04-08 → 04-09)
Hard-press/long-press verse action mode. Native iOS text selection suppressed. Selection grouping classes (`selected-start`/`middle`/`end`) so adjacent verses render as one continuous highlight. Haptic helper.

### Phase 5 — Mobile shell redesign (2026-04-18 → 04-29)
Mobile-first app shell. Book sheet with drag-to-dismiss and midpoint snapping. Scroll-direction chrome hiding. Scroll preservation across phone sleep/resume. Bible reader converted to **one `.scripture-card` per chapter** with `.verse-row` children — do not reintroduce per-verse cards.

### Phase 6 — Accounts & sync (2026-04-24)
Supabase Auth sign-in/up/out, `user_stack_state` table with per-user RLS, stack import/export, stack switcher, admin CLI.

### Phase 7 — Semantic search (2026-05-01 → 05-02)
The largest technical build. In-browser Transformers.js (`all-MiniLM-L6-v2`) embeds the query → pgvector HNSW similarity in Supabase → hybrid rerank against keyword candidates. Made translation-aware (KJV + BSB embeddings, 31,102 rows each). Phrase-aware boosts added so remembered wording surfaces the right verse. Final tuning let strong semantic matches outrank shallow keyword overlap.

**Verified:** query `Saul threw a spear at Jonathan` returns `1 Samuel 20:33` as result #1.

### Phase 8 — Voice Mode (2026-06-04 → 06-17, and ongoing)
See below. Four commits, then the current uncommitted redesign.

### Gap: 2026-06-17 → 07-31
No commits. Work resumed 07-31 on the voice-quality question.

---

## Voice Mode — where it actually stands

Hands-free TTS for verses, selections, chapters, and Stack cards.

### Architecture (this part is good — build on it)

`voice.js` is **provider-abstracted**. The bottom line is literally:

```js
const provider = new KokoroProvider(new WebSpeechProvider());   // voice.js:1073
const engine   = new VoiceEngine(provider);
```

The provider interface is the swap seam:

```
isSupported() · getVoices() · speakChunk(text,{voiceId,rate}) -> {promise,cancel}
pause() · resume() · cancel() · prefetch?() · onVoiceSelected?()
```

Anything implementing that shape drops in **without touching the UI**. `VoiceEngine` (playlist, repeat modes, delay, state machine) and `VoicePlayer` (the floating `#voice-bar`) are provider-agnostic.

Engine hardening already done: session token invalidates stale async callbacks; error-streak guard prevents tight loops; pause/resume heartbeat keeps long utterances alive past Chrome/iOS ~15s cutoff; handles iOS flaky-pause.

### Provider 1 — WebSpeechProvider (works, sounds bad)

Uses the OS `speechSynthesis`. Auto-picks the best installed English voice via `_score()` — boosts en-US/Premium/Enhanced/Neural/Google/Microsoft, heavily demotes novelty voices (Albert, Zarvox). On the user's Mac the best available is **Samantha** (no Premium/Enhanced voices installed).

**This is what the user is hearing, and it is the complaint.** "Sounds too mechanical."

### Provider 2 — KokoroProvider (in the code, effectively failed)

`onnx-community/Kokoro-82M-v1.0-ONNX` via `kokoro-worker.js`, WASM/q8. 14 voices in the picker.

**Never produced audible output for the user.** Earlier test: selected `Kokoro Heart` on laptop, waited ~10 minutes on "Generating Kokoro audio…", heard nothing. Multiple rounds of fixes (worker thread, timeouts, status text, background warming, per-chunk fallback) did not resolve it.

It falls back to Web Speech silently in several places — `voice.js:274-290` (model not ready), `voice.js:317` (generation failed), 60s generation timeout. **Net effect: the user believes they are using Kokoro but hears Web Speech.**

Practical constraint: ~80MB model download running in WASM inside an iOS PWA. Do not keep debugging this unless explicitly asked.

### Known limitations (platform, not bugs)
- iOS pauses TTS/audio when the screen locks or the tab backgrounds.
- Rate/voice changes apply to the **next** utterance, not the in-flight one.
- Repeat is verse/passage looping until Stop (no fixed-count repeat).

---

## What We're Doing Now (2026-07-31)

**Goal: make scripture audio sound like a real voice.**

### The reframe that drives the plan

Scripture is a **fixed, finite corpus**. Acts 10 in KJV never changes. Synthesizing it live on the phone on every play — which is what the app does today — is wasted work that also guarantees the phone's mechanical voice. Every serious app in this space **pre-renders audio once and serves files**.

This also means: static GitHub Pages hosting **cannot hold an API key**. Any cloud TTS needs a proxy — `server.js` or a Supabase Edge Function.

### Options evaluated

| Option | Sound | Cost | Blocker |
|---|---|---|---|
| Web Speech (current) | Mechanical | Free | — it's the problem |
| Kokoro (current) | Decent | Free | Never worked on device |
| Enhanced system voices | OK | Free | User must install in OS settings |
| Pre-rendered OpenAI TTS → Supabase Storage | Very good | ~tens of $ for full KJV | Needs key + proxy |
| Pre-rendered ElevenLabs | Best synthetic | ~10–20× OpenAI | Needs key + proxy |
| **Human narration (FCBH / Bible Brain)** | **Real human** | **Free** | **Needs free API key** |

_Cost figures are from June 2026 research and are unverified as of this update — confirm current rates before committing to a budget._

### Current direction: human narration via Bible Brain (FCBH)

The user chose **real human narration** over synthesis.

**Verified 2026-07-31 via web research:**
- Bible Brain (FCBH's API, powers bible.is) is the Digital Bible Platform v4 — REST, JSON, free for non-commercial use, requires a developer key.
- It has **Audio Timings endpoints** returning the start time of each verse.
- Coverage was **231 bibleIds** as of their last published count — not universal, per-version.

**NOT yet verified:** whether **KJV specifically** has audio *with* verse timings. The docs do not publish the list; it requires an authenticated query.

**Why timings matter:** the player's per-verse features (verse repeat, repeat delay, prev/next, now-playing highlight) all assume verse-level addressing. A plain chapter MP3 is one blob and would break them. Verse timings preserve the whole existing feature set.

### Immediate next steps

1. **User:** request a free key at https://4.dbt.io/api_key/request — arrives by email.
2. **Assistant:** query the API to confirm KJV has audio + verse timings.
3. If yes → implement `FCBHProvider` against the existing seam:
   - `getVoices()` → available audio filesets (dramatized / non-dramatized)
   - `speakChunk()` → seek into the chapter audio at the verse's start time, play until the next verse's start
   - `prefetch()` → already supported by `VoiceEngine` (`voice.js:745-748`), use it
4. If KJV lacks timings → fall back to pre-rendered OpenAI TTS, **one file per verse** (simpler than chapter files + timestamps, and maps directly onto the existing queue).

### Decisions already made
- Do not keep debugging Kokoro.
- Do not put any API key in client code.
- Prefer pre-rendered/cached audio over live synthesis.
- Lazy generation (render a chapter on first open, cache forever) over rendering all 31,102 verses upfront.

---

## Deploy Checklist (CRITICAL — 4 anchors, all together)

Current values in the working tree:

| Anchor | Location | Current |
|---|---|---|
| `style.css?v=N` | `index.html:16` | **104** |
| `app.js?v=M` | `index.html:262` | **96** ⚠️ needs 97 |
| `voice.js?v=P` | `app.js:2` (import specifier) | **10** |
| `CACHE = 'scripture-vK'` | `sw.js:1` | **106** |

**Why:** GitHub Pages serves assets with caching headers. Only a changed URL forces a refetch. The SW is network-first so the SW cache isn't the issue — the browser HTTP cache is.

**`voice.js` is an ES module imported by `app.js`** — its version lives in the import specifier, NOT `index.html`. Bumping `app.js?v=` does NOT refresh `voice.js`. A `voice.js` edit needs **both** `P` (the import) and `M` (app.js, whose text changed) bumped.

GitHub Pages serves `index.html` with `max-age=600`. If a change isn't showing, wait 10 min or hard-refresh.

**The user tests on their phone — always commit and push after changes.**

---

## What This App Is

A **Bible study PWA** installable on iPhone/Android.

- Multi-translation reader (18 translations)
- **Semantic search** — meaning-based, typo-tolerant (Transformers.js + Supabase pgvector)
- **Stacks** — user-created verse collections, localStorage + Supabase sync
- **Voice Mode** — TTS playback of verses/chapters/stacks
- Greek word analysis for NT verses
- Compare translations side-by-side
- Reader settings: font, size, spacing, light/dark
- Account sync via Supabase Auth; JSON import/export

---

## Hosting

- Remote: `https://github.com/nwabuokumich-debug/Scripture-app.git`, branch `main`
- Live: `https://nwabuokumich-debug.github.io/Scripture-app/`
- Deploy: push to `main` → GitHub Pages auto-deploys (30–60s)
- `manifest.json` `start_url`/`scope` are relative (`./`) — if redeploying under the `/Scripture-app/` subpath, revert these

---

## Database (Supabase)

Project: `klrvxlltgeibglszsezq.supabase.co`

### Tables

**`books`** — `id` INTEGER PK (1–66), `name`, `testament` (`'old'`/`'new'`)

**`verses`** — `id` SERIAL PK, `book_id` → books, `chapter`, `verse`, `text`, `translation` (default `'kjv'`)

**`verse_embeddings`** — composite PK (`translation`, `book_id`, `chapter`, `verse`), `embedding vector(384)` (all-MiniLM-L6-v2), HNSW cosine index, public read RLS.
Live: **31,102 KJV rows + 31,102 BSB rows**

**`user_stack_state`** — `user_id` UUID PK, `stacks` JSONB, `updated_at`; RLS per-user

**`nt_word_tags`** + **`strongs_lexicon`** — Greek data; not in `schema.sql`, may not exist

### RPC
`search_verses_semantic(query_embedding vector(384), match_count int, target_translation text)` — ranks across available translation embeddings, groups by verse reference, keeps best distance per verse, returns text in `target_translation`. Granted to anon + authenticated.

### Indexes
```sql
idx_verses_location        ON verses(book_id, chapter, verse, translation)
idx_verses_fts             ON verses USING gin(to_tsvector('english', text))
idx_verses_translation     ON verses(translation)
idx_verse_embeddings_hnsw  ON verse_embeddings USING hnsw (embedding vector_cosine_ops)
```

### If adding audio storage
A Supabase Storage bucket for rendered audio is the planned home for pre-rendered files. Not yet created.

---

## File Structure

```
/
├── index.html              # App shell, all UI markup
├── app.js                  # All frontend logic (137KB) — imports voice.js
├── voice.js                # Voice Mode subsystem (1109 lines)
├── kokoro-worker.js        # Kokoro worker — never produced audible output
├── style.css               # All styles (78KB)
├── config.js               # Supabase URL + anon key
├── sw.js                   # Service worker (network-first)
├── server.js               # Local dev server, port 4173 (npm run start|dev)
├── manifest.json           # PWA manifest (relative start_url/scope)
├── icon.svg
├── schema.sql
├── migration-add-translation.sql
├── migration-add-user-stack-state.sql
├── migration-add-verse-embeddings.sql
├── migration-translation-aware-embeddings.sql
├── embed-verses.js         # Per-translation embedding job
├── stack-admin.js          # Service-role stack admin CLI
├── import*.js              # Data import scripts
└── package.json            # includes @xenova/transformers
```

---

## Import Scripts

Require `npm install`. Run from repo root.

| Script | Imports | How |
|---|---|---|
| `embed-verses.js` | Embeddings for one translation | `SUPABASE_SERVICE_KEY=xxx TRANSLATION=bsb node embed-verses.js` |
| `import-bsb.js` | BSB | `SUPABASE_SERVICE_KEY=xxx node import-bsb.js` |
| `import-modern.js` | AKJV, UKJV, LITV, MKJV, CPDV | `SUPABASE_SERVICE_KEY=xxx node import-modern.js` |
| `import-translations.js` | WEB, Darby, Webster, DRA | `SUPABASE_SERVICE_KEY=xxx node import-translations.js` |
| `stack-admin.js` | Admin CLI | `SUPABASE_SERVICE_KEY=xxx node stack-admin.js check --email x` |

Gitignored (hardcoded secrets): `import.js`, `import-greek.js`, `clear.js`, `clear-greek.js`

---

## Key Patterns in app.js

### Search
- `preloadEmbedder()` — lazy-loads `Xenova/all-MiniLM-L6-v2` from jsDelivr (~25MB, cached). Warmed when the search sheet opens.
- `embedQueryVector(text)` — returns a 384-element float array.
- `doSearch()` — reference parser first (direct jump), then semantic: embed → pgvector literal string → `search_verses_semantic` RPC → merge with keyword candidates → rerank → render.
- `fetchKeywordCandidates()` — also searches 3- and 4-word phrase fragments.
- `mergeAndRankSearchResults()` — keyword + semantic + phrase + hybrid bonus + semantic-confidence boost.

### Voice integration (app.js holds no voice logic)
Imports `Voice`/`initVoice`. All Play UI feature-gated on `Voice.isSupported`. Play affordances in 4 places: `updateSelectionBar` (verse-action bar), `doSearch` (results), `renderStackView` (cards), `renderVerses` (chapter "Listen" pill). `Voice.stopScripture()` on navigation: `selectChapter`, `openBibleLocation`, `setMode`, `openStack`. Translation change funnels through `selectChapter`.

### State variables
`activeTranslation` · `TRANSLATIONS` (18 slugs) · `selectedVerses` · `appMode` (`'bible'`/`'stacks'`) · `activeStackId` · `greekByVerse` · `bookChapterCounts` · `expandedBookId`

### Stacks
- localStorage key `study_stacks`; cloud table `user_stack_state`
- `[{ id, title, verses: [{ passages: [{ ref, text }], note, addedAt }], createdAt, updatedAt }]`
- Signed in → merged by `id`, newer `updatedAt` wins

### Verse selection classes
`selected` · `selected-start` (top corners 14px) · `selected-middle` (no rounding) · `selected-end` (bottom corners) · `action-active` (long-pressed verse)

### localStorage keys
`study_stacks` · `active_translation` · `reader_settings` · `scripture_scroll_state` · `voice_settings`

---

## Known Issues

1. **Client cache masks fixes** — if the phone disagrees with verified local behavior, stale `index.html` / SW cache is the first suspect.
2. **⚠️ Supabase service key was committed to git history** — rotate at Supabase → Project Settings → API. Still outstanding.
3. **Greek tables may not exist** — `nt_word_tags`, `strongs_lexicon` not in `schema.sql`.
4. **Cache busting is manual** — 4 anchors, easy to miss one (currently `app.js?v=` is out of sync).
5. **Kokoro is dead weight** — 14 voices in the picker that silently fall back to Web Speech. Consider hiding them; they make the user think they're hearing Kokoro when they aren't.
6. **6 weeks of unpushed work** — the player redesign has never been device-tested.

---

## Tips

1. **Read `app.js` top-to-bottom once** — all logic in one file, no framework.
2. **Voice work goes in `voice.js`** — respect the provider seam; don't put provider logic in `VoiceEngine` or `VoicePlayer`.
3. **Books sheet** — expandable per-book chapter grid; dismisses via Cancel, backdrop, or drag-down (midpoint snap).
4. **Bible reader layout** — one `.scripture-card` per chapter. Do NOT reintroduce per-verse cards.
5. **Scroll resume** — don't call `renderStackView(..., { resetScroll: true })` on resume.
6. **Adding a translation** — add slug/name to `TRANSLATIONS` in `app.js`, write an import script, run it.
7. **Local dev** — `npm run start` (port 4173, `PORT` env to change). Serves `Cache-Control: no-store`.
8. **Semantic search is translation-aware** — RPC ranks across all embedded translations, joins to the active one.
9. **Confirm before pushing** when a commit bundles unrelated features.
