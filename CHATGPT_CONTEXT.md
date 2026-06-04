# Scripture App Project Dossier

This document is a full, repo-readable explanation of the current `claude-demo` project (the "Scripture" app) written so that another AI assistant — specifically ChatGPT — can understand the **entire project end to end without reading the source code**: both *what the app is and why it exists* (the product idea) and *how every part of it works* (the engineering).

If you are an assistant reading this: by the end of this document you should be able to answer "what does this app do, what is it trying to be, and how is it built?" without opening a single file.

It covers:

- **the product vision — the idea behind what this app is trying to be** (Section 0)
- what the app is and who it is for
- how the frontend works
- how search works
- how stacks work
- how Supabase is used
- what each tracked file does
- what the migrations and import scripts do
- how the styling system is organized
- how the project evolved through git history
- current state of in-progress (uncommitted) work
- current risks and known issues

It does not include private terminal output unless that information was written into the repo or summarized here.

> **Maintenance note for assistants:** keep this document in sync with the code. When a feature, table, file, or version changes, update the matching section here. This file and `CODEX_HANDOFF.md` are the two canonical handoff documents; this one is the narrative/conceptual dossier, `CODEX_HANDOFF.md` is the operational engineering log (current versions, credentials, deploy steps, uncommitted work).

## 0. Product Vision — The Idea Behind Scripture

This section exists so a reader understands the *intent* of the product, not just its mechanics. Everything in the later sections is in service of this idea.

### What the maker is trying to build

Scripture is meant to be a **beautiful, modern, mobile-first way to read, search, and study the Bible** — something that feels like a polished consumer reading app (think the care of a Things/Bear/Apple-Books-class product) rather than a plain database front-end or a cluttered legacy Bible site.

The guiding idea is: *the Bible is the content, but the experience should feel personal, fast, calm, and intelligent.* The product is deliberately opinionated about typography, motion, and touch feel because the maker treats Scripture reading as a **reading experience worth designing**, not just data retrieval.

### The four things the product is trying to deliver

1. **A first-class reader.** Clean, distraction-free chapter reading with real typographic control (a large curated font list, size, line spacing, light/dark theme) and smooth mobile chrome that gets out of the way as you read. Multiple translations so the reader is not locked to one English text.

2. **Search that understands meaning, not just words.** The signature ambition. A user should be able to type a half-remembered idea — *"the verse about Saul throwing a spear at Jonathan"* or a paraphrased story — and land on the right verse, even if they don't remember the exact wording or reference. This is why the app invests in semantic (embedding-based) search on top of plain keyword search and direct reference parsing.

3. **A personal study workspace ("Stacks").** Users collect verses into named collections, group related passages into single cards, attach notes, reorder them, compare translations, and carry that study with them. Stacks are **local-first** (work instantly, offline, no account needed) but can **sync to the cloud** when the user signs in, so study follows them across devices.

4. **Depth for serious study.** New Testament **Greek word study** (Strong's lexicon + word tags) and **side-by-side translation comparison** turn the app from a casual reader into a study tool.

### Product principles the codebase reflects

- **Mobile-first, phone-real.** The maker tests on an actual iPhone, installed as a PWA. Long-press verse actions, haptics, drag-to-reorder, scroll-direction chrome hiding, and resume-where-you-left-off all exist because the target is a phone in someone's hand, not a desktop browser tab.
- **Local-first, cloud-optional.** Nothing important requires an account. The account/sync layer is additive, not a gate.
- **No framework, no build step, deliberately simple runtime.** Vanilla HTML/CSS/JS hosted statically on GitHub Pages plus Supabase. This keeps the app cheap to host, easy to inspect, and easy to patch — at the cost of a large single `app.js`.
- **Polished feel over feature sprawl.** Much of the git history is interaction polish (selection highlight, sheet motion, scroll behavior) rather than new features, which tells you the maker cares about *how it feels* as much as *what it does*.

### What this app is NOT (current scope boundaries)

- It is **not** an AI chat / Q&A-about-the-Bible app today. The "intelligence" is in *finding* verses (semantic search), not in conversational answers. (A future chat layer that uses search results as retrieval context is an open idea — see Section 75 — but it does not exist yet.)
- It is **not** a multi-user social or sharing product. Sync is per-user, private (RLS-protected). There is no sharing/feed/collaboration.
- It is **not** offline-first in the strict sense — the service worker is network-first, so it prefers fresh content and only falls back to cache.

### The one-sentence pitch

**Scripture is a static, framework-free, mobile-first Bible study PWA that pairs a beautifully typeset multi-translation reader with meaning-based (embedding) search, a local-first-but-cloud-syncable verse-collection workspace, side-by-side translation compare, and New Testament Greek word study.**

## 1. Project Identity

- App name in UI and manifest: `Scripture`
- Page title pattern: `Scripture Search — <translation> Bible`
- Type: mobile-first Bible study Progressive Web App
- Hosting model: static frontend on GitHub Pages plus Supabase backend
- Frontend style: framework-free vanilla HTML/CSS/JS
- Deployment target: installable mobile web app / PWA

The current product combines four major experiences:

1. Bible reader
2. semantic and direct-reference search
3. study stacks for saved verses and notes
4. Greek word study overlay for New Testament verses

## 2. High-Level Architecture

The project is intentionally simple in runtime architecture:

- `index.html` provides the entire app shell
- `style.css` provides all layout, theme, motion, and component styles
- `app.js` contains essentially all frontend logic
- `config.js` exposes the Supabase project URL and anon key to the browser
- Supabase stores books, verses, embeddings, auth state, and synced stacks
- a service worker caches assets and uses a network-first strategy

There is no React, Vue, build tool, router, or server-rendered layer.

This makes the app:

- easy to host statically
- easy to inspect
- easy to patch directly
- but also means `app.js` is large and centralizes many concerns

## 3. Core Product Features

Current headline capabilities:

- Multi-translation Bible reading
- direct reference parsing like `John 3:16`
- semantic verse search using embeddings
- keyword fallback / hybrid reranking
- verse long-press action mode
- multi-verse selection
- translation comparison sheet
- stacks of saved verse cards
- grouped passage cards inside stacks
- notes on stack cards
- per-card translation switching in stacks
- drag-to-reorder stack cards
- import/export stacks as JSON
- Supabase Auth sign-in/up/out
- cloud stack sync
- Greek word study overlay for NT passages when Greek tables exist
- reader settings for font, size, spacing, and light/dark theme
- mobile chrome hide/show based on scroll direction
- **Scripture Voice Mode**: free on-device text-to-speech that reads a verse, a multi-verse selection, a whole chapter, or a Stack card aloud, with a floating player (play/pause/resume/stop, prev/next, speed, system-voice picker, repeat verse/passage, repeat delay) — see Section 78

## 4. Current Tracked File Map

### Frontend runtime

- `index.html`: all visible app markup and modal/sheet containers
- `app.js`: application logic, event handling, state, search, stacks, auth, compare, settings (imports `voice.js`)
- `voice.js`: Scripture Voice Mode subsystem — Web Speech (`speechSynthesis`) text-to-speech with a provider abstraction, the floating audio player, and playback state (see Section 78)
- `style.css`: full styling system
- `config.js`: Supabase URL and anon key
- `sw.js`: service worker with network-first caching
- `manifest.json`: PWA metadata
- `icon.svg`: app icon

### Local dev / hosting

- `server.js`: minimal Node static HTTP dev server (no dependencies) for testing locally with no-store caching — see Section 76
- `manifest.json`: PWA metadata (now uses relative `./` `start_url`/`scope` — see Section 10)

### Database migrations / backend prep

- `migration-add-translation.sql`: adds `translation` support to `verses`
- `migration-add-user-stack-state.sql`: adds synced stack storage and RLS
- `migration-add-verse-embeddings.sql`: adds pgvector semantic search infrastructure (translation-aware embeddings + `search_verses_semantic` RPC)
- `migration-translation-aware-embeddings.sql`: upgrade migration for existing Supabase projects that previously had the old KJV-only embeddings table

### Data / admin scripts

- `embed-verses.js`: one-time job to compute and upload verse embeddings
- `import-bsb.js`: imports Berean Standard Bible
- `import-modern.js`: imports AKJV, UKJV, LITV, MKJV, CPDV
- `import-translations.js`: imports WEB, HNV, ERV, Darby, Webster, DRA, WNT
- `import-web-dra.js`: alternate importer for WEB and DRA from XML sources
- `stack-admin.js`: service-role CLI for user stack inspection and mutation

### Meta / ops

- `package.json`: scripts and dependencies
- `package-lock.json`: dependency lockfile
- `CODEX_HANDOFF.md`: operational engineering handoff and issue log (current versions, credentials, deploy steps, uncommitted work)
- `CHATGPT_CONTEXT.md`: this document — the narrative/conceptual project dossier
- `.gitignore`: ignored local, secret, and generated files

## 5. Files Mentioned But Not Tracked

`.gitignore` references files that are not currently tracked:

- `import.js`
- `import-greek.js`
- `clear.js`
- `clear-greek.js`
- `schema.sql`
- `.claude/`
- `node_modules/`

Interpretation:

- some earlier database/bootstrap work happened in local scripts that are intentionally excluded
- the original schema file is missing from the tracked repo even though the app clearly depends on tables like `books` and `verses`
- some secrets were likely hardcoded in the ignored scripts per `CODEX_HANDOFF.md`

## 6. package.json and Dependencies

`package.json` currently declares:

- `@supabase/supabase-js`
- `@xenova/transformers`

Scripts:

- `npm start` / `npm run dev` -> `node server.js` (local static dev server, see Section 76)
- `npm run import` -> `node import.js`
- `npm run stack:admin` -> `node stack-admin.js`
- `npm run embed` -> `node embed-verses.js`

Important note:

- `npm run import` points at `import.js`, but that file is gitignored and not present in the tracked repo
- this means the script exists conceptually in the project workflow but is not reproducible from the clean repo alone

## 7. Runtime Frontend Structure in index.html

`index.html` defines the full app surface.

### Main panes

- `#bible-pane`: reader view
- `#stacks-pane`: saved stack view

Only one pane is active at a time. The mode switch is done by toggling classes and `aria-hidden`.

### Bible pane structure

- top bar with:
  - `#book-picker-btn`
  - `#translation-label`
  - `#account-btn`
  - `#search-open`
  - `#settings-btn`
- `#chapter-bar`
- `#bible-content`
- `#verse-area`

### Stacks pane structure

- top header
- import/export/account buttons
- new stack button
- `#stacks-summary`
- `#stack-list`
- `#stack-detail`

### Global navigation

- bottom nav with `Bible` and `Stacks`

### Overlay / sheet / modal infrastructure

- books sheet
- search sheet
- settings sheet
- Greek overlay
- compare sheet
- generic prompt/confirm modal
- auth modal
- hidden file input for stack import

### Script loading

- loads `config.js` first
- registers `sw.js`
- loads `app.js` as a module with cache-busting query string

## 8. config.js and Environment Model

`config.js` contains:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

These are intentionally browser-visible. That is normal for Supabase anon/public usage.

What is not in the browser:

- service role key

The frontend relies on:

- public reads from Bible-related tables
- authenticated per-user writes to `user_stack_state`

## 9. Service Worker Strategy

`sw.js` defines:

- cache name: currently `scripture-v95`
- `install`: `skipWaiting()`
- `activate`: delete old caches and claim clients
- `fetch`: network-first, then fallback to cache on failure

Important operational behavior:

- this is not an offline-first app shell strategy
- it prefers fresh network responses
- it still caches responses opportunistically
- GitHub Pages HTML caching means `index.html` versioning and asset query strings matter

Known maintenance requirement:

- whenever JS or CSS changes, both the asset query strings in `index.html` and the cache name in `sw.js` should be bumped

## 10. PWA Manifest

`manifest.json` configures:

- `name`: `Scripture — KJV Bible`
- `short_name`: `Scripture`
- standalone display
- portrait orientation
- start and scope set to relative `./`
- theme/background colors
- SVG icon as both normal and maskable icon

`start_url`/`scope` were recently changed from the GitHub Pages project path (`/Scripture-app/`) to relative `./`. This makes the app portable across deployment targets (local dev server, root domains, other hosting). **Caveat:** if the app ever needs to be served under the `/Scripture-app/` subpath again, these values must be reverted; the production GitHub Pages URL is still served from that subpath.

## 11. App Icon

`icon.svg` is extremely simple:

- rounded red square background
- white star glyph

This is consistent with the project’s visual language:

- accent red dominates the UI
- iconography is intentionally minimal

## 12. app.js Overall Role

`app.js` is the project brain. At roughly `3690` lines, it contains:

- Supabase client bootstrapping
- all DOM references
- app state
- view transitions
- Bible reading flow
- search logic
- compare logic
- Greek overlay logic
- stacks data model and UI
- auth and sync logic
- settings persistence
- scroll/chrome behavior
- mobile gesture handling

There is no module split. That is convenient for a solo static app, but it also means:

- coupling is high
- state is implicit and global
- regression risk rises as features are added

## 13. Global Runtime State in app.js

Important top-level state variables:

- `allBooks`: list of books from Supabase
- `activeTestament`
- `activeBook`
- `activeChapter`
- `greekByVerse`: current chapter Greek tags grouped by verse
- `defCache`: Strong's definition cache
- `currentVerses`: current chapter verse rows
- `appMode`: `bible` or `stacks`
- `activeStackId`
- `activePicker`: current stack picker / switcher popup
- `selectedVerses`: global multi-select state
- `verseActionMode`
- `activeActionVerseNum`
- `stackCompareMode`
- `activeStackCompareIdx`
- `stackCompareSelectedRefs`
- `bookOrderMode`: `traditional` or `alphabetical`
- `activeTranslation`
- `cardTranslations`: per-stack-card temporary translation override map
- auth and sync state variables
- scroll persistence variables

The app relies heavily on these globals rather than a formal store.

## 14. Supabase Client Usage Pattern

`app.js` imports Supabase from jsDelivr:

- `@supabase/supabase-js@2/+esm`

Then creates one browser client using the public URL and anon key.

Typical frontend query types:

- fetch books
- fetch chapter verses
- fetch compare rows
- fetch Greek tags
- fetch Strong's definitions
- auth session lookup
- auth sign-in/up/out
- read/write `user_stack_state`
- RPC for semantic search

## 15. Boot Process

The boot flow is:

1. `applySettings(loadSettings())`
2. measure pane chrome
3. bind scroll-driven chrome hide/show
4. reset pane chrome state
5. `init()`

`init()` then:

1. loads all books from Supabase
2. initializes auth
3. migrates old stack passage formats
4. syncs UI state
5. renders initial lists/summaries
6. attempts to restore prior view and scroll position
7. falls back to welcome screen if nothing is restorable

If books fail to load, the Bible pane shows a connection error pointing at `config.js`.

## 16. Pane and Chrome Behavior

The app treats each main pane as having collapsible top chrome.

Important functions:

- `measurePaneChrome`
- `measureAllPaneChrome`
- `bindPaneChromeScroll`
- `setPaneChromeCollapsed`
- `showPaneChrome`
- `resetChromeScroll`

Behavior:

- top bars and chapter rails are measured
- CSS custom properties store their heights
- as the user scrolls down, chrome can collapse
- as the user scrolls up, chrome reappears
- Bible and stacks panes have independent scroll state

This is one of the app’s more polished mobile behaviors.

## 17. Scroll Persistence

The app persists scroll/view state into localStorage under:

- `scripture_scroll_state`

Saved shape includes:

- current mode
- Bible book/chapter/translation/scrollTop
- stacks activeStackId/scrollTop
- timestamp

Persistence is triggered by:

- pane scroll
- `pagehide`
- `visibilitychange`

Restore logic:

- if last mode was stacks, reopen the same stack and restore its scroll
- if last mode was Bible, reopen the same book/chapter and restore scroll

This was added after several commits focused on mobile resume and scroll-jump behavior.

## 18. Book Picker

The books UI is a bottom sheet with:

- drag-to-dismiss
- backdrop dismissal
- Cancel button
- traditional vs alphabetical ordering toggle
- **per-book expansion: tapping a book expands it in place to reveal an inline chapter grid**, so the user can jump straight to a chapter without first selecting the book and waiting for the reader to load

Important functions:

- `openBookSheet` (preserves `expandedBookId` so the previously expanded book stays open when reopening)
- `closeBookSheet`
- `setBookOrderMode`
- `getOrderedBooks`
- `renderBookList` (builds expandable book items, each with a caret and a lazily-loaded chapter grid)
- `getBookChapterCount(book)` — fetches the max chapter for a book *in the active translation* on demand
- `selectBook`

Supporting state:

- `bookChapterCounts` — Map caching chapter counts per book id
- `pendingChapterCountLoads` — Set guarding against duplicate in-flight count fetches
- `expandedBookId` — which book is currently expanded in the sheet

Because chapter counts can differ per translation, switching translation clears `bookChapterCounts` so counts are re-fetched fresh.

Book ordering modes:

- `traditional`
- `alphabetical`

The tabs are mislabeled in the DOM ids as `tab-ot` and `tab-nt`, but they actually mean:

- Traditional
- Alphabetical

not Old Testament / New Testament.

## 19. Bible Reader Flow

When the user selects a book:

1. app switches to Bible mode
2. stores active book/testament
3. loads total chapter count for active translation
4. renders chapter buttons
5. loads chapter 1

When the user selects a chapter:

1. app updates active chapter
2. loads all verse rows for that book/chapter/translation
3. clears selection state
4. if NT, attempts to load Greek tags
5. renders the chapter as one grouped reading card

Current reader design:

- one `.scripture-card` per chapter
- many `.verse-row` children inside it

This replaced earlier per-verse card layouts.

## 20. Verse Rendering Structure

`renderVerses()` builds:

- a hero section with testament, book title, chapter, translation
- a grouped scripture card
- each verse as a `.verse-row`

Each verse row includes:

- `data-vnum`
- verse number
- verse text
- optional `has-greek` class

If Greek data is present for the chapter, the hero shows `Greek Study Ready`.

## 21. Search System: Old vs Current

The search system has evolved.

Earlier versions relied mainly on simple substring search via Supabase `ilike`.

Current search is hybrid:

- direct reference parser first
- keyword candidate fetch
- semantic embedding search
- hybrid reranking

This means the app is no longer purely lexical, but it still retains lexical signals to improve practical quality.

## 22. Reference Parser

`parseReference(query)` supports inputs like:

- `Psalm 1`
- `John 3:16`
- `Psalm 1:1-4`

Behavior:

- loosely matches book names
- supports optional verse and verse range
- if it succeeds, search bypasses semantic logic entirely

Direct-reference lookup is intentionally higher priority than embeddings.

## 23. Semantic Search Model

The semantic model is:

- `Xenova/all-MiniLM-L6-v2`

This is not a chat model.

It is an embedding model whose job is:

- take text
- produce a 384-dimensional numeric vector

Frontend constants:

- `EMBED_MODEL_URL = https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2`
- `EMBED_MODEL_NAME = Xenova/all-MiniLM-L6-v2`

The model is loaded dynamically in the browser the first time semantic search is needed.

## 24. Where the Model Runs

For live search queries:

- the model downloads into the browser
- it runs locally on the user’s device

For Bible verse embeddings:

- Node jobs embedded KJV and BSB verses offline
- those vectors live in Supabase

So runtime search works like this:

1. app embeds query locally
2. sends the query vector to Supabase as a pgvector literal string
3. Supabase compares it to stored verse vectors across available embedded translations
4. Supabase groups matches back to verse references
5. app displays the winning verse in the currently selected translation

## 25. Semantic Search Data Flow

Core search functions:

- `preloadEmbedder()`
- `embedQueryVector(text)`
- `fetchKeywordCandidates(query)`
- `mergeAndRankSearchResults(query, semanticRows, keywordRows)`
- `doSearch()`

Flow:

1. user enters text
2. app checks if it is a direct Bible reference
3. if not, app starts keyword candidate fetch, including phrase fragments
4. app loads embedding model if needed
5. app embeds the query into 384 floats
6. app calls Supabase RPC `search_verses_semantic`
7. app receives semantic candidates
8. app combines them with keyword candidates
9. app reranks hybrid results
10. app renders up to 30 results

## 26. Hybrid Reranking Logic

The hybrid stage is important.

Keyword side:

- stopwords are stripped
- terms are normalized
- some fuzzy matching is done via small Levenshtein tolerance
- longer or exact phrase matches score higher

Semantic side:

- similarity from the cross-translation vector search is preserved

Combined score:

- keyword score is weighted
- semantic score is weighted more strongly than before
- a semantic-confidence boost is applied for unusually strong semantic matches
- phrase score adds extra weight for exact or ordered remembered wording
- a bonus is applied if a result appeared in both keyword and semantic sets

This is the current response to two different failure modes:

- phrase-like remembered wording not entering the candidate pool
- paraphrased story queries being buried by shallow literal keyword overlap

## 27. Search UX Details

When search opens:

- the app focuses the input
- starts warming the embedding model in the background

Loading message changes depending on model state:

- if model not loaded: warns about one-time smart search download
- if model loaded: normal searching message

Results:

- show count
- each result has reference, verse text, and add button
- clicking a result jumps to Bible location
- clicking `+` adds it to selection mode rather than immediately mutating stacks

Recent mobile UX update:

- pushed in commit `4555ef1`
- the search header was redesigned because the input, `Search`, and `Close` controls were cramped on phone screens
- `index.html` moved `#search-btn` outside `.search-pill`
- `style.css` now gives the input full width on small screens and places `Search` / `Close` on a separate action row
- search behavior and ranking logic were not changed by this UI update
- this follows mobile search guidance: keep the field clearly attached to the content it filters and avoid squeezing important actions into the text field

## 28. Current Search State

The old KJV-only / vector-casting diagnosis is now outdated.

What is true now:

- the app sends `query_embedding` as a pgvector literal string
- `verse_embeddings` is translation-aware
- live Supabase has both KJV and BSB embeddings populated (`31,102` rows each)
- the semantic RPC ranks across available translation embeddings, then returns the verse text in the selected translation
- `fetchKeywordCandidates()` now includes phrase fragments
- `mergeAndRankSearchResults()` now gives genuinely strong semantic matches enough weight to outrank shallow literal keyword overlap

Verified example:

- Query: `Saul threw a spear at Jonathan`
- Raw semantic RPC returns `1 Samuel 20:33` as result #1 for `target_translation='kjv'`
- Full local reproduction of the app merge/rank path also returns `1 Samuel 20:33` as result #1 after commit `2726213`

The key code shape is:

```js
queryVec = await embedQueryVector(query);
const queryVectorLiteral = `[${queryVec.map((value) => Number(value).toFixed(8)).join(',')}]`;
const { data, error } = await supabase.rpc('search_verses_semantic', {
  query_embedding: queryVectorLiteral,
  match_count: 120,
  target_translation: activeTranslation,
});
```

## 29. Compare Sheet

Comparison functionality supports:

- single verse comparison across translations
- multiple selected verse comparison grouped by translation
- stack-card compare mode

Relevant functions:

- `openCompare()`
- `openCompareSelectedVerses()`
- `renderCompareTranslationRows()`
- `renderComparePassageRows()`
- `closeCompare()`

The compare sheet is a bottom sheet overlay.

For multiple selected verses, the app:

- fetches each verse in all available translations
- groups returned rows by translation
- renders one translation section containing all selected passages

## 30. Greek Word Study

Greek study is available only when:

- current book is New Testament
- `nt_word_tags` has matching rows

Relevant functions:

- `showGreekPage()`
- `closeGreekPage()`

Process:

1. chapter loads
2. if NT, the app fetches word tags for that chapter
3. if a verse has Greek data, it can be surfaced through action mode
4. opening the Greek overlay fetches Strong's definitions from `strongs_lexicon`
5. definitions are cached in `defCache`

Important caveat:

- `nt_word_tags` and `strongs_lexicon` are not defined in tracked migrations
- therefore Greek support depends on external/untracked database setup

## 31. Verse Action Mode

This is one of the more specialized interaction systems.

Behavior:

- long-press a verse row
- app enters action mode
- selected verses get a unified highlight treatment
- bottom selection bar appears

Actions available:

- Greek
- Compare
- Add to Stack
- Done / clear

Touch handling includes:

- long-press timer
- movement threshold to cancel accidental press
- vibration / haptics when entering mode
- suppression window to avoid accidental tap fallout after long press

## 32. Verse Selection Styling Semantics

Selection state classes:

- `selected`
- `selected-start`
- `selected-middle`
- `selected-end`
- `action-active`

Purpose:

- visually merge consecutive verse selections into one continuous block
- avoid striped overlap artifacts
- preserve an emphasized “active” verse within the selection

This styling area has a long history of refinement in git.

## 33. Stacks Conceptual Model

Stacks are saved study collections.

Data shape:

- stack
  - `id`
  - `title`
  - `verses` array
  - `createdAt`
  - `updatedAt`

Each item in `verses` is actually a card:

- `passages`: one or more verse refs/text pairs
- `note`
- `addedAt`

This means a “verse card” can represent:

- one verse
- a contiguous verse block
- a custom grouped set of passages

## 34. Local Stacks Storage

Stacks are cached locally in:

- `study_stacks`

Normalization helpers:

- `normalizePassage`
- `normalizeStackCard`
- `normalizeStack`
- `normalizeStacks`

Design goal:

- tolerate older formats
- clean malformed data
- keep a consistent internal shape

## 35. Stack Sync Model

Cloud sync uses:

- Supabase Auth for identity
- `user_stack_state` table for persistence

Important functions:

- `initAuth()`
- `applyAuthSession()`
- `hydrateStacksFromCloud()`
- `flushStackSync()`
- `scheduleStackSync()`

Behavior:

- local stacks always exist
- if signed out, state is local-only
- if signed in, local and remote are merged
- merge prefers more recent `updatedAt`
- sync is debounced by `500ms`

UI sync states:

- `local`
- `syncing`
- `synced`
- `error`

## 36. Stack Auth UI

Auth modal supports:

- sign in
- sign up
- sign out

It uses Supabase browser auth methods:

- `signUp`
- `signInWithPassword`
- `signOut`

The auth copy and account button change based on signed-in status.

The stacks pane also surfaces account/sync status through summary pills and labels.

## 37. Stack Merge Semantics

When local and remote stacks conflict:

- they are merged by `id`
- `pickPreferredStack()` chooses the newer one by `updatedAt`
- if timestamps tie, the version with more verses wins

This is intentionally simple. It avoids deep per-card merge logic.

Tradeoff:

- less complexity
- but simultaneous edits can still overwrite finer-grained changes

## 38. Stack Summary UI

`renderStacksSummary()` builds:

- empty state CTA when no stacks exist
- compact metrics card when stacks exist

Metrics shown:

- total passages
- total cards
- total stacks
- active/open stack
- account email if signed in
- sync status

The summary is not purely decorative; it is part of the product’s information architecture.

## 39. Stack List / Switcher

Current stacks rail is not a traditional visible list of all stacks.

Instead:

- it shows the current stack in a switcher button
- clicking opens an overlay stack switcher

This is a mobile optimization introduced later in project history.

Related functions:

- `renderStacksList()`
- `openStackSwitcher()`
- `openStack()`
- `closeStackPicker()`

## 40. Stack Detail View

`renderStackView()` is a major renderer.

It shows:

- editable stack title
- delete stack button
- total saved passage count
- add/search input
- stack cards

Each card shows:

- compact ref label
- remove button
- one or more passage rows
- add / note / compare / translation buttons
- optional note textarea
- optional add-passage area

If a card’s passages are consecutive in the same chapter, the header ref is compressed into range format.

## 41. Stack Card Translation Overrides

Each card can temporarily display another translation without rewriting the stored card.

Mechanism:

- `cardTranslations` map stores translation override by card index
- when switching, app re-fetches passage text in the selected translation
- only rendered row text changes
- stored canonical refs remain the same

This is a UI-layer override, not a schema-level change.

## 42. Add-Passage-to-Card Flow

Each card can be extended with more passages.

The in-card add area supports:

- direct reference search
- lexical text search fallback

If the user enters a reference:

- the app fetches matching verses in the active translation
- displays them
- clicking appends the passage to the card

This makes stacks usable as grouped study bundles rather than single-verse bookmarks.

## 43. Stack Compare Mode

Separate from Bible selection mode, stacks have their own compare selection mode.

Concept:

- user clicks `Compare` on a stack card
- card becomes active
- user may optionally choose specific passage rows from the card
- compare sheet opens using either selected rows or the whole card

State variables:

- `stackCompareMode`
- `activeStackCompareIdx`
- `stackCompareSelectedRefs`

## 44. Drag-to-Reorder

Stack cards can be reordered on touch devices via long press.

Implementation:

- global touch listeners on `stackDetail`
- long-press to enter drag
- placeholder inserted
- dragged card becomes fixed-position overlay
- sibling opacity lowers
- auto-scroll near top/bottom edges
- final DOM order is converted back into reordered data array

This system has been rewritten several times in git history.

## 45. Stack Import / Export

Export:

- serializes normalized stacks
- downloads `scripture-stacks-<date>.json`

Import:

- reads chosen file
- parses JSON
- normalizes stack structure
- confirms merge
- merges with existing stacks

This preserves the local-first nature of the stacks feature.

## 46. Stack Admin CLI

`stack-admin.js` is a service-role operational tool.

Supported commands:

- `check`
- `list --email`
- `dump --email`
- `search --query`
- `add-refs --email --stack --ref`

This script can:

- inspect users
- load user stack state
- append verse refs into a named stack
- create stacks if missing

It is useful for support/debugging and confirms that stack sync has an admin-side operational path.

## 47. Reader Settings

Reader settings are stored in localStorage under:

- `reader_settings`

Supported settings:

- theme
- size
- spacing
- font

Important helpers:

- `loadSettings()`
- `saveSettings()`
- `getEffectiveSettings()`
- `applySettings()`
- `buildFontList()`
- `syncPanelUI()`

The settings panel itself is a bottom sheet.

## 48. Fonts

The app deliberately offers many font choices, including:

- Source Serif 4
- Lora
- Merriweather
- Playfair Display
- EB Garamond
- Crimson Pro
- Libre Baskerville
- Cormorant Garamond
- Spectral
- Vollkorn
- Bitter
- PT Serif
- Noto Serif
- San Francisco
- Inter
- Roboto
- Open Sans
- Lato
- Nunito
- Raleway
- Josefin Sans

Interpretation:

- the reader is treated as a reading product, not just a data interface
- typography customization is a product-level feature

## 49. LocalStorage Keys in Use

Current known keys:

- `book_order_mode`
- `active_translation`
- `study_stacks`
- `scripture_scroll_state`
- `reader_settings`

These keys are central to restoring the app’s personal state without requiring login.

## 50. CSS Architecture Overview

`style.css` is roughly `2500` lines.

It is organized by component blocks:

- root variables / reset
- pane
- top bar
- chapter rail
- content area
- bottom nav
- sheets
- search results
- state messages
- stacks
- stack detail
- compare sheet
- Greek page
- selection bar
- translation picker
- stack picker
- toast
- modal
- settings panel
- dark theme
- responsive rules

This mirrors the app structure well.

## 51. CSS Design Language

The design system is built around:

- red accent `#e74252`
- light off-white / paper neutrals
- soft shadows
- pill controls
- blurred translucent sheet/top-bar backgrounds
- serif reading fonts + sans UI fonts

The product wants to feel:

- more like a polished reading app
- less like a plain admin dashboard

## 52. CSS Variables

Key root variables:

- background colors
- surface colors
- borders
- accent colors
- text colors
- shadows
- nav height
- UI and reading fonts

This makes theme and component consistency manageable despite the single CSS file.

## 53. Dark Theme

Dark mode is not a separate stylesheet.

It is implemented by toggling `body.theme-dark`, which redefines:

- backgrounds
- borders
- text colors
- selection colors
- sheet/panel colors
- card gradients
- compare row surfaces
- sync status pills

Dark mode support has clearly been tuned post-launch, especially for reader card contrast.

## 54. Selection Styling

The verse selection styling specifically uses:

- solid backgrounds instead of semi-transparent overlap tricks
- inset accent bars
- start/end rounding only on group edges

This area received multiple commits because the grouped-chapter reader introduced adjacency artifacts.

## 55. Motion and Sheet Behavior

The CSS and JS together implement:

- bottom-sheet opening and closing
- translation picker rise animation
- compare sheet motion
- stack switcher overlay motion
- selection bar slide-up/down
- pane transition between Bible and stacks
- drag visual treatment

Several commits specifically mention GPU-composited transitions and smoother sheet motion.

## 56. Database Tables in Active Use

The repo currently assumes these tables:

- `books`
- `verses`
- `verse_embeddings`
- `user_stack_state`
- `nt_word_tags`
- `strongs_lexicon`

Only the last two are not represented in tracked schema migrations.

## 57. books Table

Expected fields based on usage:

- `id`
- `name`
- `testament`

Used for:

- book picker
- testament labeling
- joining verse search results to human-readable book names

## 58. verses Table

Expected fields based on usage:

- `id`
- `book_id`
- `chapter`
- `verse`
- `text`
- `translation`

Used for:

- chapter rendering
- compare sheet
- search candidates
- stack passage lookup
- import scripts

## 59. verse_embeddings Table

Created by `migration-add-verse-embeddings.sql`.

Fields:

- `translation`
- `book_id`
- `chapter`
- `verse`
- `embedding vector(384)`

Properties:

- composite primary key
- HNSW index with cosine ops
- public select policy

Purpose:

- search over verse meaning vectors for multiple translations
- live DB currently has KJV and BSB embedding sets

## 60. user_stack_state Table

Created by `migration-add-user-stack-state.sql`.

Fields:

- `user_id`
- `stacks`
- `updated_at`

RLS policies:

- users can read their own row
- users can insert their own row
- users can update their own row

This is the only tracked piece of per-user synchronized application state.

## 61. search_verses_semantic RPC

Created by `migration-add-verse-embeddings.sql`.

Inputs:

- `query_embedding vector(384)`
- `match_count`
- `target_translation`

Returns:

- `book_id`
- `book_name`
- `chapter`
- `verse`
- `text`
- `similarity`

Logic:

- nearest-neighbor search across available translation embeddings
- group duplicate translation matches back to one `(book_id, chapter, verse)`
- keep the best semantic distance per verse
- join that verse reference to the requested translation text
- return top N by cosine distance

This is the core of the semantic search backend.

Important frontend call detail:

- send the query vector as a pgvector literal string, not a raw JS array
- the app formats the array as `[0.12345678,-0.23456789,...]`
- this avoids relying on PostgREST / Supabase implicit array-to-vector casting
- if future edits touch this RPC call, preserve `query_embedding: queryVectorLiteral`

## 62. Translation Migration

`migration-add-translation.sql`:

- adds `translation` column to `verses`
- recreates location index including translation
- ensures text search and translation indexes exist

This migration marks the shift from a KJV-only app to a multi-translation app.

## 63. Embedding Job Script

`embed-verses.js` is a one-time or resumable offline worker.

Behavior:

- reads all KJV verses from Supabase
- loads `Xenova/all-MiniLM-L6-v2`
- computes normalized mean-pooled embeddings in batches
- upserts to `verse_embeddings`
- skips rows that already exist

Constants:

- translation: `kjv`
- model: `Xenova/all-MiniLM-L6-v2`
- embed batch: `32`
- upload batch: `200`

The handoff notes say it already ran for all `31,102` verses.

## 64. Translation Import Scripts

The project has multiple importer generations, which shows the translation catalog evolved over time.

### import-bsb.js

- fetches BSB CSV from `scrollmapper/bible_databases`
- uses book-name normalization map
- inserts batches into `verses` with `translation = 'bsb'`

### import-modern.js

- imports AKJV, UKJV, LITV, MKJV, CPDV
- simple CSV parsing with normalization

### import-translations.js

- imports WEB, HNV, ERV, Darby, Webster, DRA, WNT
- supports optional single-target run by CLI argument
- deletes existing rows for a translation before reinserting

### import-web-dra.js

- alternate importer using XML parsing
- parses USFX for WEB and Zefania XML for DRA

Interpretation:

- translation ingestion was iterative
- some sources were replaced when CSV quality/availability was poor
- some translations were later removed from the product after discovering empty or unusable data

## 65. Supported Translations in Current UI

Current `TRANSLATIONS` object includes:

- KJV
- BSB
- WEB
- AKJV
- UKJV
- MKJV
- LITV
- CPDV
- Darby
- Webster
- DRA
- YLT
- ASV
- BBE
- NHEB
- Jubilee
- LEB
- Rotherham

Important note from git history:

- OEB, HNV, ERV, WNT were at some point explored or imported but are not in the current active list

## 66. Haptics

`triggerHaptic()` tries:

1. Capacitor haptics if present
2. browser `navigator.vibrate` otherwise

This indicates the app may have been considered for hybrid app shell packaging in addition to pure web deployment.

## 67. Accessibility / Usability Notes

Existing accessibility/usability-minded choices include:

- `aria-hidden` pane toggles
- `aria-current` on nav buttons
- explicit `type="button"` on many controls
- touch-friendly targets
- long-press behavior to avoid accidental verse action triggers
- hidden native text selection on verse rows to reduce mobile friction

At the same time, being a custom vanilla UI means some areas likely still rely more on visual correctness than formal a11y structure.

## 68. Current Git Status Snapshot

At the time this document was last updated:

- branch: `main`
- last pushed commit: `2726213` `Let strong semantic matches outrank shallow keyword hits`

There is a batch of **uncommitted local work** in the tree (not yet pushed; the maker tests on a physical phone, so it has to be pushed to GitHub Pages and the cache cleared before it can be tested on device). This work is:

- **New file `server.js`** — minimal Node static dev server (see Section 76)
- **New file `CHATGPT_CONTEXT.md`** — this document
- **`app.js`** — expandable book sheet with inline chapter grid (`bookChapterCounts`, `pendingChapterCountLoads`, `expandedBookId`, `getBookChapterCount`)
- **`style.css`** — new components for the book expansion UI (`.book-item-wrap`, `.book-item-caret`, `.book-chapter-grid`, `.book-chapter-btn`, `.book-chapter-loading`) plus dark-theme variants
- **`manifest.json`** — `start_url`/`scope` changed from `/Scripture-app/` to relative `./`
- **`package.json`** — added `start`/`dev` scripts pointing at `server.js`
- **`index.html` + `sw.js`** — cache-buster bumps for the above (currently `style.css?v=96`, `app.js?v=88`, `sw.js` `CACHE = 'scripture-v95'`)
- **`CODEX_HANDOFF.md`** — updated with the above

See `CODEX_HANDOFF.md` for the authoritative, always-current version/credential/deploy state.

## 69. Full Git History Themes

The tracked git history shows a clear progression:

### Phase 1: initial app foundation

- `b22b83a Initial commit`

The initial commit already contained:

- app shell
- main reader
- service worker
- styles
- package files

So this repo did not start as an empty scaffold; it began as a functioning PWA.

### Phase 2: GitHub Pages and service-worker stabilization

Early commits addressed:

- PWA path fixes for GitHub Pages
- service worker path issues
- cache clearing
- old service worker removal
- mobile UI close button visibility
- touch target sizing

This suggests the first real production pain was stale assets and mobile install behavior.

### Phase 3: stacks and interaction polish

The next large wave added:

- stacks
- drag reorder
- inline note/add actions
- better transitions
- more compact mobile layouts
- reader size/spacing integration

### Phase 4: grouped verse cards and selection UX

Then the app evolved from discrete verse cards to a grouped chapter reader with:

- grouped `.scripture-card`
- tighter spacing
- multi-select
- compare of multiple selected verses
- red/green highlight experiments
- merged adjacent selection visuals

### Phase 5: translation expansion

Another major phase added:

- translation support in DB
- many import scripts
- compare sheet
- translation picker
- per-card translation switching

This transformed the app from KJV-centric reading into a multi-translation study tool.

### Phase 6: mobile-first shell redesign

Commits then focused on:

- redesigned mobile shell
- compact stacks header
- book sheet drag interactions
- scroll-aware chrome
- settings sheet improvements
- stack switcher
- responsive layout fixes

### Phase 7: auth and sync

Another major expansion:

- account sign-in
- user stack sync
- import/export
- admin tooling

This is the project’s primary move from single-device utility to cross-device product.

### Phase 8: semantic search

Latest major feature:

- pgvector
- verse embeddings
- in-browser query embeddings
- hybrid reranking

This is the biggest architectural change in the current codebase.

## 70. Notable Git Milestones by Commit

Some especially informative commits:

- `b22b83a`: initial working product
- `219520c`: hard-press verse action mode
- `1b5d7fe`: compare translations feature
- `20c423d`: multi-translation support with BSB
- `0a28250`: store multi-verse selections as separate passages instead of text blob
- `d2b7396`: mobile-first redesign
- `e2c77ec`: auth + import/export + sync
- `d7c19e7`: grouped Bible verses in one reader card
- `052f589`: semantic search via pgvector + Transformers.js
- `e9f7826`: hybrid reranking
- `00f1168`: handoff update with open bug notes

## 71. Known Issues and Risks

### Semantic search quality on phone

- highest current functional risk

### Missing tracked base schema

- `schema.sql` is gitignored and absent
- full database reproduction from scratch is incomplete

### Service role exposure history

- handoff says a service key was committed in older ignored/local script history
- if still valid, it should be rotated

### Greek dependencies are underdocumented

- no tracked migration for `nt_word_tags` or `strongs_lexicon`

### app.js scale

- file size and single-file architecture increase regression risk

### Manual cache busting

- deployment correctness still relies on human discipline

## 72. Current Strengths

- static deployability
- clean mobile-first UX intent
- unusually strong Bible-reading typography options
- thoughtful stack model for grouped passages
- local-first with optional cloud sync
- semantic search architecture is modern and reasonably well-contained
- codebase is easy to inspect because there is no framework indirection

## 73. Current Weaknesses

- frontend monolith
- incomplete tracked schema
- operational knowledge partly lives in handoff text and git history
- search quality still needs broader testing, but the known pgvector payload fix has been applied
- some translation/import history is messy and reflects source inconsistency

## 74. If Another Assistant Needs the Fastest Mental Model

The shortest correct summary is:

This is a static vanilla-JS Bible study PWA that reads Bible text from Supabase, lets users save grouped verse cards into local-first stacks, optionally syncs those stacks to a per-user Supabase table, supports multi-translation compare and NT Greek word study, and now uses browser-side embeddings plus Supabase pgvector for semantic verse search. The search system is no longer KJV-only: live Supabase has KJV and BSB embeddings, the semantic RPC ranks across embedded translations, and the client reranker now gives strong semantic matches enough weight to beat shallow keyword overlap in paraphrased story queries.

## 75. Questions Another Assistant Could Productively Answer

- After adding BSB embeddings and cross-translation ranking, what remaining search queries still fail and why?
- Should `app.js` be split into modules, and what is the lowest-risk split plan?
- How should the missing base schema and Greek tables be reconstructed into tracked SQL?
- Is `Xenova/all-MiniLM-L6-v2` the right model for Bible semantic search, or should a different embedding model be used?
- How should a future chat assistant layer use current verse search results as retrieval context? (This is the most likely "next big idea" — the product currently *finds* verses but does not *answer questions about* them.)

## 76. Local Dev Server (`server.js`)

`server.js` is a minimal, dependency-free Node static file server added to make local testing possible without GitHub Pages.

Behavior:

- listens on `127.0.0.1:4173` by default (`HOST` and `PORT` env vars override)
- serves files from the current working directory
- maps `/` to `index.html`
- only allows `GET`/`HEAD`; returns `405` otherwise, `404` for missing files
- sends `Cache-Control: no-store` on every response — deliberately no caching, so local edits always show immediately

Run it with `npm start` or `npm run dev`.

Why it exists:

- lets the maker test service-worker / cache-busting behavior and the relative-path manifest locally
- pairs with the manifest `./` change so the app can run from a plain root rather than only the `/Scripture-app/` GitHub Pages subpath

Caveat: because it serves from root with relative paths, it depends on the manifest's relative `start_url`/`scope`. If the manifest is reverted to the `/Scripture-app/` subpath for production, local serving expectations change accordingly.

## 77. How the Two Handoff Documents Relate

There are two canonical handoff files; an assistant should know which to use:

- **`CHATGPT_CONTEXT.md`** (this file) — the *narrative dossier*. Explains what the product is, the idea behind it, and how every subsystem works conceptually. Best for building a complete mental model.
- **`CODEX_HANDOFF.md`** — the *operational engineering log*. Authoritative for the live, fast-changing details: current cache-buster versions, exact uncommitted diff, credentials/rotation warnings, Supabase table/RPC/index DDL, import-script invocation commands, and deploy steps.

When the two disagree on a fast-moving fact (e.g. a version number), trust `CODEX_HANDOFF.md` and update this file to match.

## 78. Scripture Voice Mode

Lets the user **listen** to scripture instead of only reading it. Free and on-device — it uses the browser **Web Speech API** (`window.speechSynthesis`), with no ElevenLabs/OpenAI/external voice service.

### What the user can do
- Play a single verse, a multi-verse selection, an entire chapter, or a Stack card.
- Pause, resume, stop; skip to previous/next verse.
- Adjust reading speed (0.5×–2.0×).
- Pick from the device's available system voices.
- Repeat a single verse, repeat the whole passage, and set a delay between repetitions.

### Where the controls appear
A **Play/Listen affordance** is added in four places, all feature-gated on `speechSynthesis` support (hidden entirely on unsupported browsers):
1. Verse action mode — a `Play` button in the selection bar (the action grid becomes 2×2).
2. Search results — a small ▶ button beside each result's `+`.
3. Stack cards — a `Listen` button alongside Add/Note/Compare (it reads the text currently shown, so a card's translation override is honored).
4. Chapter reader — a `Listen` pill in the reader hero.

Playback is driven from a **floating player** (`#voice-bar`) styled like the existing selection bar (dark in both themes, pinned above the bottom nav, persists while scrolling). It shows the current reference, transport controls, and a chevron that expands a tray for speed / voice / repeat / delay. During chapter playback the current verse gets a `.verse-speaking` highlight and scrolls into view.

### Architecture (`voice.js`)
A dedicated, self-contained ES module imported by `app.js`. It deliberately keeps voice logic out of `app.js`:
- **Provider abstraction (the swap seam).** `WebSpeechProvider` implements `isSupported / getVoices / speakChunk / pause / resume / cancel`. A future `ElevenLabsProvider` or `OpenAIProvider` implements the same interface and is swapped in with a one-line change — **no UI rewrite**. (Paid keys must not ship client-side; they'd be proxied via `server.js` or a Supabase Edge Function.)
- **`VoiceEngine`** (provider-agnostic): playlist, repeat modes (`none | verse | passage`), repeat delay, and a state machine (`idle | playing | paused`). It speaks one utterance per verse so the current verse can be highlighted and the long-utterance cutoff bug is avoided.
- **`VoicePlayer`**: owns the single persistent `#voice-bar` DOM (built once, handlers bound once) and `voice_settings` in localStorage.
- `app.js` only adds the Play buttons, supplies a verse-highlight callback via `initVoice(...)`, and calls `Voice.stopScripture()` when the user navigates away (chapter change, mode switch, opening a different stack, translation change).

### Robustness details worth knowing
- A **session token** (bumped on every stop/new-play) makes stale async speech callbacks no-op — prevents double-advance and stuck states.
- An **error-streak guard** stops a tight loop if synthesis errors while in Verse repeat.
- A `pause()/resume()` **heartbeat** keeps long utterances alive (Chrome/iOS ~15s cutoff) and is always cleared on stop/pause/end (no leaked timers).
- Handles **iOS flaky `pause()`**: if an utterance finishes during a pause, resume advances rather than hanging.

### Known limitations
- iOS pauses TTS when the screen locks / tab is backgrounded (platform constraint, not fixable client-side).
- Changing speed/voice applies to the **next** utterance, not the one currently playing.
- "Repeat indefinitely" is realized as Verse/Passage looping until Stop (no fixed-count repeat).

### Maintenance note
`voice.js` is a **4th cache-bust anchor**: it is imported as `./voice.js?v=N` from `app.js` line 2. Bump that `N` whenever `voice.js` changes (and bump `app.js`'s own `?v=` too). See [[feedback_cache_busters]].
