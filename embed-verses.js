// One-time job: embed every verse for one translation with all-MiniLM-L6-v2 and upsert
// the 384-dim vector into the verse_embeddings table on Supabase.
//
// Prereq: run migration-add-verse-embeddings.sql first.
// Existing DBs also need migration-translation-aware-embeddings.sql once.
// Then:   TRANSLATION=bsb node embed-verses.js
//
// Resumable: skips verses that already have an embedding row.

import { createClient } from '@supabase/supabase-js';
import { pipeline } from '@xenova/transformers';

const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY before running embed-verses.js');
  process.exit(1);
}

const TRANSLATION  = (process.env.TRANSLATION || 'kjv').toLowerCase();
const MODEL_NAME   = 'Xenova/all-MiniLM-L6-v2';
const BATCH_EMBED  = 32;
const BATCH_UPLOAD = Number(process.env.BATCH_UPLOAD || 40);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function fetchAllVerses() {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('verses')
      .select('book_id, chapter, verse, text')
      .eq('translation', TRANSLATION)
      .order('book_id').order('chapter').order('verse')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch verses: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchExistingKeys() {
  const keys = new Set();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('verse_embeddings')
      .select('translation, book_id, chapter, verse')
      .eq('translation', TRANSLATION)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch existing: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) keys.add(`${r.translation}:${r.book_id}:${r.chapter}:${r.verse}`);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return keys;
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function main() {
  console.log(`Loading ${MODEL_NAME}...`);
  const embedder = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
  console.log('Model loaded.');

  console.log(`Fetching ${TRANSLATION.toUpperCase()} verses...`);
  const verses = await fetchAllVerses();
  console.log(`Got ${verses.length} verses.`);

  console.log('Checking which verses already have embeddings...');
  const existing = await fetchExistingKeys();
  const todo = verses.filter(v => !existing.has(`${TRANSLATION}:${v.book_id}:${v.chapter}:${v.verse}`));
  console.log(`${existing.size} already embedded; ${todo.length} to process.`);
  if (!todo.length) { console.log('Nothing to do.'); return; }

  const start = Date.now();
  let pending = [];
  let done = 0;

  async function flushUpload() {
    if (!pending.length) return;
    const { error } = await supabase
      .from('verse_embeddings')
      .upsert(pending, { onConflict: 'translation,book_id,chapter,verse' });
    if (error) throw new Error(`upsert: ${error.message}`);
    pending = [];
  }

  for (let i = 0; i < todo.length; i += BATCH_EMBED) {
    const batch = todo.slice(i, i + BATCH_EMBED);
    const texts = batch.map(v => v.text);
    const out = await embedder(texts, { pooling: 'mean', normalize: true });
    // out.data is a Float32Array of length batch.length * 384
    const dim = 384;
    for (let j = 0; j < batch.length; j++) {
      const slice = Array.from(out.data.slice(j * dim, (j + 1) * dim));
      pending.push({
        translation: TRANSLATION,
        book_id: batch[j].book_id,
        chapter: batch[j].chapter,
        verse:   batch[j].verse,
        embedding: slice,
      });
    }
    done += batch.length;

    if (pending.length >= BATCH_UPLOAD) {
      await flushUpload();
    }

    const pct = ((done / todo.length) * 100).toFixed(1);
    const elapsed = Date.now() - start;
    const rate = done / (elapsed / 1000);
    const remain = (todo.length - done) / rate;
    process.stdout.write(`\r${pct}% (${done}/${todo.length}) | ${rate.toFixed(1)} verses/s | eta ${fmtTime(remain * 1000)}    `);
  }

  await flushUpload();
  console.log(`\nDone in ${fmtTime(Date.now() - start)}.`);
}

main().catch(err => {
  console.error('\n' + err.stack || err);
  process.exit(1);
});
