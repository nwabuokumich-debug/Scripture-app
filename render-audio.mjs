// Render a chapter of scripture to per-verse MP3s using OpenAI TTS.
//
// One file per verse, because the player addresses audio per verse (repeat,
// delay, prev/next, now-playing highlight). A single chapter blob would break
// all of that.
//
// Usage:
//   node render-audio.mjs --book "Psalms" --chapter 23
//   node render-audio.mjs --book "Psalms" --chapter 23 --voice onyx --translation kjv
//
// Reads OPENAI_API_KEY from the environment or .env.local (gitignored).
// Output lands in ./audio-out/<translation>/<book_id>/<chapter>/<verse>.mp3

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CbjVMe77ZKmpnzk6R9oDTw_hVNmKJZu';

const MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'marin';
const OUT_ROOT = 'audio-out';

// --repo writes into ./audio/<translation>/<Book>-<ch>-<v>.mp3, which is what
// the app fetches. The filename is derived from the verse `ref` the player
// already carries, so no book-id lookup is needed at playback time.
const REPO_ROOT = 'audio';

// The delivery instruction — this is the part a system voice cannot do.
const INSTRUCTIONS =
  'Read slowly and reverently, unhurried, with warmth and gravity. ' +
  'Observe the punctuation: pause at colons and semicolons. ' +
  'Do not dramatize or perform; read as a trusted narrator would.';

// ── args ────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const bookName    = arg('book');
const chapter     = Number(arg('chapter'));
const translation = arg('translation', 'kjv');
const voice       = arg('voice', DEFAULT_VOICE);
// --out overrides the destination, so voice comparisons don't collide.
const outOverride = arg('out');
const toRepo      = process.argv.includes('--repo');

// Must match slugForRef() in voice.js — "Psalms 23:1" -> "Psalms-23-1".
function slugForRef(ref) {
  return String(ref).trim().replace(/\s+/g, '-').replace(/:/g, '-');
}

if (!bookName || !chapter) {
  console.error('Usage: node render-audio.mjs --book "Psalms" --chapter 23 [--voice onyx] [--translation kjv]');
  process.exit(1);
}

// ── key ─────────────────────────────────────────────────────────────────
async function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (existsSync('.env.local')) {
    const txt = await readFile('.env.local', 'utf8');
    const m = txt.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const OPENAI_API_KEY = await loadKey();
if (!OPENAI_API_KEY) {
  console.error('No OPENAI_API_KEY. Put it in .env.local as OPENAI_API_KEY=sk-... or export it.');
  process.exit(1);
}

// ── fetch the chapter ───────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data: books, error: bookErr } = await supabase
  .from('books').select('id, name').ilike('name', bookName).limit(1);

if (bookErr) throw bookErr;
if (!books?.length) {
  console.error(`Book not found: "${bookName}"`);
  process.exit(1);
}
const book = books[0];

const { data: verses, error: verseErr } = await supabase
  .from('verses')
  .select('verse, text')
  .eq('book_id', book.id)
  .eq('chapter', chapter)
  .eq('translation', translation)
  .order('verse', { ascending: true });

if (verseErr) throw verseErr;
if (!verses?.length) {
  console.error(`No verses for ${book.name} ${chapter} (${translation}).`);
  process.exit(1);
}

const totalChars = verses.reduce((n, v) => n + v.text.length, 0);
console.log(`${book.name} ${chapter} (${translation}) — ${verses.length} verses, ${totalChars} chars`);
console.log(`Voice: ${voice} · Model: ${MODEL}`);
console.log(`Estimated cost: ~$${(totalChars / 1_000_000 * 15).toFixed(3)}\n`);

// ── render ──────────────────────────────────────────────────────────────
const outDir = toRepo
  ? path.join(REPO_ROOT, translation)
  : outOverride
    ? path.join(OUT_ROOT, outOverride)
    : path.join(OUT_ROOT, translation, String(book.id), String(chapter));
await mkdir(outDir, { recursive: true });

const destFor = (v) => toRepo
  ? path.join(outDir, `${slugForRef(`${book.name} ${chapter}:${v.verse}`)}.mp3`)
  : path.join(outDir, `${v.verse}.mp3`);

async function synth(text) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: text,
      instructions: INSTRUCTIONS,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

let done = 0;
for (const v of verses) {
  const dest = destFor(v);
  if (existsSync(dest)) { console.log(`  v${v.verse} — cached, skipping`); done++; continue; }

  // Retry once on transient failure; a rate limit shouldn't kill the run.
  let buf;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { buf = await synth(v.text); break; }
    catch (err) {
      if (attempt === 2) throw err;
      console.warn(`  v${v.verse} — ${err.message.slice(0, 80)}; retrying in 3s`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await writeFile(dest, buf);
  done++;
  console.log(`  v${v.verse} — ${(buf.length / 1024).toFixed(0)} KB  (${done}/${verses.length})`);
}

console.log(`\nDone. ${done} files in ${outDir}/`);
console.log(`Listen:  open ${outDir}`);
