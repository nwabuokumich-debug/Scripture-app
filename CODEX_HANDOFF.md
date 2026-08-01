# Scripture App — Handoff Document

_Last updated: 2026-08-01_

---

## Current Status (read this first)

- Repo branch: `main`. Last commit `0102579` (2026-07-31), pushed and live on GitHub Pages.
- **Voice quality is solved.** Pre-rendered OpenAI TTS (voice `marin`) replaced the mechanical system voice. User confirmed on device: "sounds perfect." See [Voice Quality — SOLVED](#voice-quality--solved-2026-07-31).
- **Background playback is solved.** A passage now plays as one stitched MP3 stream, so audio no longer stops at the first verse when the phone sleeps. See [Background playback](#background-playback--the-continuous-stream-2026-07-31).
- The Voice Mode player was rebuilt as a light bottom sheet and device-tested the same day. The ~6 weeks of unpushed work is gone — everything is committed and pushed.

**Complete and working.** Any verse plays in marin. Storage bucket, Edge Function, and secret are all live and verified end to end.

**One action item before trusting "Load again":** the `tts` Edge Function gained a `force` flag in `0102579`'s series (commit `270fb5e`) but the deployed copy on Supabase may predate it — it is deployed by pasting source into the dashboard, not by `git push`. Redeploy `supabase/functions/tts/index.ts` if a re-render is ever needed. Without it, "Load again" still repairs local/SW cache corruption but cannot overwrite a bad stored render.

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

### Phase 8 — Voice Mode (2026-06-04 → 06-17)
Four commits building the TTS subsystem and player. See below.

### Phase 9 — Real voices (2026-07-31, morning)
After a six-week gap, replaced synthesis-on-device with pre-rendered OpenAI TTS. Commits `37e8d53` (provider + renderer) and `f59a827` (Edge Function auth). Storage bucket and `tts` function deployed and verified the same day.

### Phase 10 — Player redesign & background playback (2026-07-31, afternoon)
Seven commits in one session, all device-tested by the user as they landed:

| Commit | What |
|---|---|
| `f1ac3b2` | Voice Mode player rebuilt as a light bottom sheet — collapsed pill ↔ expanded sheet, SVG icons, theme tokens, scrubber, sleep timer |
| `270fb5e` | "Load again" button; `_misses` keyed per translation; active translation shown in the player |
| `82e0b51` | Add-to-stack picker bounded and scrollable instead of running off the top of the screen |
| `d38d45e` | Media Session — lock-screen/headphone controls, metadata |
| `ee57476` | **Passage played as one continuous stitched MP3 stream** — the real fix for playback dying on screen lock |
| `b97a170` | Repeat regression from the stream change; native `el.loop` where the loaded stream is exactly what should repeat |
| `0102579` | Repeat delay baked into the audio as real MP3 silence, so repeat-with-a-pause also survives a locked screen |

---

## Voice Mode — where it actually stands

Hands-free TTS for verses, selections, chapters, and Stack cards.

### Architecture (this part is good — build on it)

`voice.js` is **provider-abstracted**. The bottom line is literally:

```js
const provider = new AudioFileProvider(new KokoroProvider(new WebSpeechProvider()));
const engine   = new VoiceEngine(provider);
```

Each provider wraps the next as its fallback, so the chain degrades left to right.

The provider interface is the swap seam:

```
required   isSupported() · getVoices() · pause() · resume() · cancel()
           speakChunk(text, opts) -> { promise, cancel }
optional   prefetch() · onVoiceSelected() · unlock() · endSession()
           prepareSequence(items, opts) · applyRepeat(opts) -> bool
           getProgress() -> {current,duration}|null · seekTo() · seekBy()
           reload(ref) · needsHeartbeat (false = skip the keep-alive)
```

`speakChunk` opts: `voiceId · rate · item · index · restart · repeatMode · repeatDelayMs · count · onStatus`.

Every optional member is called with `?.` and guarded — Web Speech and Kokoro implement none of them and still work. Anything implementing the required shape drops in **without touching the UI**. `VoiceEngine` (playlist, repeat modes, delay, state machine) and `VoicePlayer` (the `#voice-bar` sheet) stay provider-agnostic; when a provider can't report position, the player hides the scrubber rather than special-casing the provider.

Engine hardening already done: session token invalidates stale async callbacks; error-streak guard prevents tight loops; pause/resume heartbeat keeps long utterances alive past Chrome/iOS ~15s cutoff; handles iOS flaky-pause.

### Provider 1 — WebSpeechProvider (works, sounds bad)

Uses the OS `speechSynthesis`. Auto-picks the best installed English voice via `_score()` — boosts en-US/Premium/Enhanced/Neural/Google/Microsoft, heavily demotes novelty voices (Albert, Zarvox). On the user's Mac the best available is **Samantha** (no Premium/Enhanced voices installed).

**This was the original complaint** — "sounds too mechanical." It is now the last-resort fallback only, reached when a verse has no rendered audio and none can be generated.

### Provider 2 — KokoroProvider (in the code, effectively failed)

`onnx-community/Kokoro-82M-v1.0-ONNX` via `kokoro-worker.js`, WASM/q8. 14 voices in the picker.

**Never produced audible output for the user.** Earlier test: selected `Kokoro Heart` on laptop, waited ~10 minutes on "Generating Kokoro audio…", heard nothing. Multiple rounds of fixes (worker thread, timeouts, status text, background warming, per-chunk fallback) did not resolve it.

It falls back to Web Speech silently in several places inside `KokoroProvider.speakChunk` (`voice.js:272` onward) — model not ready, generation failed, 60s generation timeout. **Net effect: the user believes they are using Kokoro but hears Web Speech.**

Practical constraint: ~80MB model download running in WASM inside an iOS PWA. Do not keep debugging this unless explicitly asked.

### Known limitations
- Rate/voice changes apply to the **next** utterance, not the in-flight one.
- Repeat is verse/passage looping until Stop (no fixed-count repeat).
- Screen-lock playback works on the stitched-stream path only. The Web Speech and Kokoro fallbacks still stop when iOS backgrounds the page — that one *is* a platform limit.
- One case still needs JS while backgrounded: **verse repeat inside a multi-verse passage**, because looping one verse of a longer stream has no native equivalent. Verse repeat on a single-verse playlist, and passage repeat on anything, both loop natively.

---

## Voice Quality — SOLVED (2026-07-31)

**Goal was: make scripture audio sound like a real voice.** Done. Shipped in `37e8d53`.

### The reframe that drove it

Scripture is a **fixed, finite corpus**. Acts 10 in KJV never changes. Synthesizing it live on the phone on every play — what the app did before — is wasted work that also guarantees the phone's mechanical voice. Render once, serve files forever.

Static GitHub Pages **cannot hold an API key**, so on-demand rendering needs a server-side proxy.

### What was chosen: pre-rendered OpenAI TTS

- Model `gpt-4o-mini-tts`, voice **`marin`**, one MP3 per verse.
- User A/B-tested all 13 OpenAI voices on Psalm 23 (~12 cents total) and picked marin. **Verdict: "sounds perfect."**
- OpenAI does **not** label voices by gender; marin/cedar are the two its docs flag as highest quality.
- A delivery instruction is sent with every request ("read slowly and reverently, unhurried… pause at colons"). This is the thing a system voice structurally cannot do.

### What was rejected, and why

| Option | Why not |
|---|---|
| Web Speech | The original complaint — mechanical. Kept as last-resort fallback. |
| Kokoro | Never produced audible output on device. Kept as fallback only. **Do not resume debugging.** |
| ElevenLabs | User judged it better, but ~6× the cost. Revisit only if marin disappoints. |
| Bible Brain / FCBH human narration | Key requires **manual approval, up to a week**. Abandoned on time-to-value. Still the best free option if synthesis is ever dropped. |
| Pre-rendering the whole Bible upfront | ~$70 and ~3GB. **Explicitly rejected by the user.** Lazy rendering only. |

### Architecture as shipped

`AudioFileProvider` in `voice.js` wraps the old chain. Resolution order per verse:

```
1. ./audio/<translation>/<Book>-<ch>-<v>.mp3   (repo, served by GH Pages — no Supabase needed)
2. Supabase Storage bucket `scripture-audio`   (normal path once rendered)
3. POST to `tts` Edge Function                 (renders on miss, stores, returns URL)
4. KokoroProvider -> WebSpeechProvider         (old voice — nothing ever dies silently)
```

- Files are keyed by the verse `ref` the player already carries (`"Psalms 23:1"` → `Psalms-23-1.mp3`). `slugForRef()` is duplicated in three places — `voice.js`, `render-audio.mjs`, and the Edge Function — and **must stay in sync**.
- `VoiceEngine` passes `item` into `speakChunk`/`prefetch`. Older providers ignore it.
- One reused `<audio>` element for the whole session: iOS unlocks playback per-element on user gesture, so reusing it is what lets verse 2 onward play without another tap.
- `_misses` (verses known unrenderable this session) is keyed `${translation}|${ref}`. Keyed on ref alone, one failed render poisoned that verse in every other translation for the rest of the session.
- Per-verse prefetch still exists for the single-file path, but does nothing in sequence mode — everything is already in one blob by then.

### Background playback — the continuous stream (2026-07-31)

**The problem.** One MP3 per verse meant JavaScript had to run at every verse boundary to start the next file. iOS throttles JS in a backgrounded page, so playback stopped after the first verse whenever the phone slept. A Media Session (`d38d45e`) gave lock-screen controls and helped, but could not fix this — the cause was architectural.

**The fix.** `prepareSequence()` fetches the whole passage, measures each verse, and concatenates the blobs into **one MP3 played by one element**. Nothing needs JS between verses, so throttling can't stop it.

Why this is safe: MP3 frames join end-to-end, and these renders are constant-bitrate 128 kbps / 24 kHz mono. Verified — six Psalm 23 files joined measure 43.824 s, the exact sum of their parts — so seeking by measured offsets is accurate.

- Verses resolve **6 at a time** (`SEQ_CONCURRENCY`), so a fresh chapter prepares in roughly one render, not thirty. Status line reports `Preparing chapter… n/N`.
- If **any** verse fails to resolve or measure, the whole sequence is abandoned and playback falls back to per-verse. A single missing verse would silently shift every later offset — better to lose the background-safety than play the wrong audio.
- `speakChunk` resolves against the shared timeline. If the page was frozen while the stream ran on, already-passed verses resolve immediately and the engine fast-forwards its index to where the audio actually is, without interrupting playback.
- `cancel()` deliberately **keeps** the stitched passage — prev/next route through it, and rebuilding a chapter per skip would be pointless. `endSession()` does the real teardown when playback ends or the user stops.
- Playback is claimed on the initiating click via a silent-WAV `unlock()`. The real `play()` now happens after fetching and stitching a whole chapter, far too late for iOS to accept it as gesture-initiated.
- The scrubber spans the whole passage rather than the current verse.

**Repeat.** `_nativeLoop()` sets `el.loop` where the loaded stream is exactly what should repeat — passage repeat on anything, verse repeat on a single-verse playlist. That needs no JS at all, so it keeps going with the screen locked.

**The repeat delay is real silence, not a timer.** `el.loop` restarts instantly and gives no way to insert a gap, so a delay would otherwise force the JS path that iOS suspends. `silenceBlob()` appends MPEG-2 Layer III frames matching the TTS renders exactly (384 bytes, 24 ms each at 24 kHz/128 kbps mono; a valid header over a zero payload decodes to silence). Verified against the system decoder: 2000 ms produces 1.992 s, and a verse plus that gap measures 6.000 s against 4.008 + 1.992.

Consequence worth knowing: **changing the delay mid-playback rebuilds the stream and restarts the verse**, because the gap is part of the audio. `applyRepeat()` returns `true` to tell the engine to restart.

**Regression to remember** (`b97a170`): repeat replays the same index, and the stream provider first treated that as a natural advance — playback was already sitting at the end of that verse, so it resolved immediately instead of seeking back. Hence the `restart` flag: a repeat, skip, or fresh play always seeks to `part.start`; only a natural step onto the *following* verse is allowed to resolve early to catch up with a stream that ran on while throttled.

### The player UI (`VoicePlayer`, owns only `#voice-bar`)

Rebuilt in `f1ac3b2` as a light bottom sheet matching the reference design.

- **Collapsed** is a slim pill: play, reference, expand, dismiss. **Expanded** is a bottom sheet: grab handle, centred title with "N of M", scrubber, transport, settings card, action row.
- Surfaces use the app's theme tokens instead of hardcoded dark, so the player follows light/dark. Emoji glyphs replaced with inline SVG (the `ICON` map).
- **Scrubber** with elapsed/duration and ±10s seek, backed by `getProgress`/`seekTo`/`seekBy`. Hidden automatically when the active provider can't report position — Web Speech has no elapsed time.
- **Sleep timer**: tap cycles 5/10/15/30/60 min (`TIMER_STEPS`), counts down in place, stops playback when it fires.
- **Closing is reachable five ways**: grab handle, header ✕, Hide, swipe down, tap-outside. Stop reading and the compact ✕ end playback entirely; stopping force-collapses the sheet and clears any running timer.
- **Active translation** is shown next to the verse count. Audio follows the app's translation, but many verses read identically across translations (BSB and KJV Psalm 23:1 are word-for-word), so there was otherwise no way to tell what was playing.
- **"Load again"** (`_reloadCurrent` → `provider.reload`) for a verse that loads truncated, silent, or from a bad render. It purges every cached copy — in-memory blob, service-worker entry, and the browser HTTP cache (Storage marks audio immutable for a year, so the refetch must use `cache: 'reload'`) — drops the stitched stream, asks the Edge Function to re-synthesize with `force: true`, and replays from the top.
- **Media Session** (`_bindMediaSession`/`_updateMediaSession`): metadata (ref as title, translation as artist) plus handlers for play/pause/stop/prev/next/seek. Gives lock-screen and headphone controls.

### The Edge Function (`supabase/functions/tts/index.ts`)

Holds `OPENAI_API_KEY`. Takes verse text **from the database, never from the request** — it is publicly callable and spends money, so it must only ever be able to synthesize actual scripture. Rejects unparseable refs, unknown books, and text over 1200 chars.

Accepts `{ ref, translation, voice, force }`. Without `force` it short-circuits on an already-stored object (`cached: true`, no OpenAI spend); with it, it re-synthesizes and overwrites — that is what "Load again" needs to repair a bad stored render.

**Not yet rate-limited.** Worth adding if the URL ever spreads. `force` makes that more pressing: it is the one path that can be made to spend money repeatedly on the same verse.

⚠️ **Deployed by hand.** `git push` does not update it — see the action item at the top.

### Service worker change (fixes a real bug)

Rendered audio now lives in an **unversioned** `scripture-audio` cache, cache-first. The app-shell cache is still wiped on every deploy (that's how new CSS/JS reaches devices) — but audio survives it. Before this, every deploy would have silently re-downloaded the user's entire audio library.

### Current state

| Piece | Status |
|---|---|
| `AudioFileProvider` | ✅ shipped and verified live |
| Stitched continuous stream | ✅ shipped; survives screen lock |
| Bottom-sheet player | ✅ shipped and device-tested |
| `render-audio.mjs` | ✅ working, resumable, prints cost before spending |
| Psalm 23 (KJV, marin) in repo | ✅ live, confirmed good on device |
| `tts` Edge Function | ⚠️ deployed and verified, but the deployed copy may predate `force` |
| `scripture-audio` Storage bucket | ✅ created, public |
| `OPENAI_API_KEY` Edge secret | ✅ set |

**Fully working as of 2026-07-31.** Any verse in any chapter plays in marin. First play of a new verse renders in ~5s; every play after is ~0.3s from Storage.

Verified end to end: John 3:16 rendered (185KB), stored, publicly playable; a second request returned `cached: true` with no new OpenAI spend; and `{"ref":"Hacked 1:1"}` was refused with HTTP 400 rather than synthesized.

### Setup that was done (for reference if it ever needs redoing)

All via the Supabase dashboard — the Homebrew install of the Supabase CLI wants Xcode Command Line Tools, which isn't worth it.

1. **Storage → New bucket** → name exactly `scripture-audio` → **Public**
2. **Settings → Edge Functions → Secrets** → `OPENAI_API_KEY`, **value only** (pasting the whole `OPENAI_API_KEY=sk-...` line from `.env.local` cost a debugging round)
3. **Edge Functions → Deploy via Editor** → name exactly `tts` → paste `supabase/functions/tts/index.ts`

Bucket and function names are hardcoded in `voice.js`.

**Gotcha worth remembering:** the Functions gateway rejects requests with no auth header (`UNAUTHORIZED_NO_AUTH_HEADER`) *before the function ever runs*, even though the function itself does no auth. The client must send the public anon key as both `Authorization: Bearer` and `apikey`. Fixed in `f59a827`.

### Cost model

~$0.06 per chapter, paid **once per verse ever**. Replays are free on any device forever. A chapter a day for a year ≈ $21. Whole Bible ≈ $70 (rejected).

### Outstanding cleanup

- **Rotate the OpenAI key** — it was displayed in a chat transcript on 2026-07-31 during setup. Nothing left the user's machine, but it should not live long-term.
- **Rotate the Supabase service key** — still in git history from earlier work.
- **The 14 Kokoro voices in the picker are misleading** — they silently fall back to Web Speech. Consider hiding them.


## Deploy Checklist (CRITICAL — 4 anchors, all together)

Current values in the working tree:

| Anchor | Location | Current |
|---|---|---|
| `style.css?v=N` | `index.html:16` | **107** |
| `app.js?v=M` | `index.html:262` | **105** |
| `voice.js?v=P` | `app.js:2` (import specifier) | **18** |
| `CACHE = 'scripture-vK'` | `sw.js:1` | **115** |

All four are in sync as of `0102579`. Commit messages in this repo record the anchors they ship — copy that habit.

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

### Storage
Bucket **`scripture-audio`** (public) holds rendered verse audio at `<translation>/<Book>-<ch>-<v>.mp3`. Written by the `tts` Edge Function and by `render-audio.mjs`; read directly by `AudioFileProvider`. Objects are served immutable for a year — which is why "Load again" has to fetch with `cache: 'reload'`.

---

## File Structure

```
/
├── index.html              # App shell, all UI markup
├── app.js                  # All frontend logic (3770 lines) — imports voice.js
├── voice.js                # Voice Mode subsystem (2003 lines)
├── kokoro-worker.js        # Kokoro worker — never produced audible output
├── style.css               # All styles (2879 lines)
├── config.js               # Supabase URL + anon key
├── sw.js                   # Service worker (network-first; audio in its own unversioned cache)
├── server.js               # Local dev server, port 4173 (npm run start|dev)
├── manifest.json           # PWA manifest (relative start_url/scope)
├── icon.svg
├── render-audio.mjs        # Batch chapter renderer: node render-audio.mjs --book "Psalms" --chapter 23
│                           #   -> audio-out/; add --repo to write audio/ (what the app fetches)
├── audio/kjv/              # Repo-committed audio; currently Psalm 23 only (6 files)
├── audio-out/              # Local render output — GITIGNORED, never committed
├── supabase/functions/tts/ # Edge Function; deployed by pasting into the dashboard
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
4. **Cache busting is manual** — 4 anchors, easy to miss one. All in sync as of `0102579`.
5. **Kokoro is dead weight** — 14 voices in the picker that silently fall back to Web Speech. Consider hiding them; they make the user think they're hearing Kokoro when they aren't.
6. **The `tts` Edge Function deploys by hand** — repo and deployment can drift silently, and currently may have (the `force` flag).
7. **Verse repeat inside a multi-verse passage still needs JS**, so that one combination stops when the screen locks. Everything else loops natively.
8. **A whole-chapter first play is front-loaded** — the stream can't start until every verse resolves. Cached chapters are instant; a never-rendered chapter shows `Preparing chapter… n/N` while ~30 verses render 6 at a time. Fine in practice, but it is a real wait where the old per-verse path started immediately.

---

## Tips

1. **Read `app.js` top-to-bottom once** — all logic in one file, no framework.
2. **Voice work goes in `voice.js`** — respect the provider seam; don't put provider logic in `VoiceEngine` or `VoicePlayer`. New optional provider members must be called with `?.` and work when absent, because Web Speech and Kokoro implement none of them.
3. **Test Voice Mode with the screen actually locked.** Anything that reintroduces a JS step between verses — a per-verse fetch, a timer, a callback that must fire to continue — silently undoes the whole stitched-stream design, and it only shows up on a sleeping phone.
4. **Books sheet** — expandable per-book chapter grid; dismisses via Cancel, backdrop, or drag-down (midpoint snap).
5. **Bible reader layout** — one `.scripture-card` per chapter. Do NOT reintroduce per-verse cards.
6. **Scroll resume** — don't call `renderStackView(..., { resetScroll: true })` on resume.
7. **Adding a translation** — add slug/name to `TRANSLATIONS` in `app.js`, write an import script, run it.
8. **Local dev** — `npm run start` (port 4173, `PORT` env to change). Serves `Cache-Control: no-store`.
9. **Semantic search is translation-aware** — RPC ranks across all embedded translations, joins to the active one.
10. **Bottom-anchored popups need a `max-height`** — the stack picker grew off the top of the screen because it had none. Anything anchored by its bottom edge above the selection bar must bound itself against both safe-area insets and scroll internally.
11. **Confirm before pushing** when a commit bundles unrelated features.
