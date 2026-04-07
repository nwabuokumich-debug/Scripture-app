// Imports WEB, HNV, ERV, Darby, Webster, DRA, WNT into Supabase
// Run: SUPABASE_SERVICE_KEY=your_key node import-translations.js
// Or a single one: SUPABASE_SERVICE_KEY=your_key node import-translations.js web

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Set SUPABASE_SERVICE_KEY env var'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BASE = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv';

const TRANSLATIONS = [
  { key: 'web',    label: 'WEB',    url: `${BASE}/WEB.csv` },
  { key: 'hnv',    label: 'HNV',    url: `${BASE}/HNV.csv` },
  { key: 'erv',    label: 'ERV',    url: `${BASE}/ERV.csv` },
  { key: 'darby',  label: 'Darby',  url: `${BASE}/Darby.csv` },
  { key: 'webster',label: 'Webster',url: `${BASE}/Webster.csv` },
  { key: 'dra',    label: 'DRA',    url: `${BASE}/DRA.csv` },
  // WNT is NT-only — will import what exists and skip missing books
  { key: 'wnt',    label: 'WNT',    url: `${BASE}/WNT.csv` },
];

const BATCH_SIZE = 500;

const NAME_FIX = {
  'I Samuel': '1 Samuel', 'II Samuel': '2 Samuel',
  'I Kings': '1 Kings', 'II Kings': '2 Kings',
  'I Chronicles': '1 Chronicles', 'II Chronicles': '2 Chronicles',
  'I Corinthians': '1 Corinthians', 'II Corinthians': '2 Corinthians',
  'I Thessalonians': '1 Thessalonians', 'II Thessalonians': '2 Thessalonians',
  'I Timothy': '1 Timothy', 'II Timothy': '2 Timothy',
  'I Peter': '1 Peter', 'II Peter': '2 Peter',
  'I John': '1 John', 'II John': '2 John', 'III John': '3 John',
  'Revelation of John': 'Revelation',
  'Song of Songs': 'Song of Solomon',
  'Song of Solomon': 'Song of Solomon',
  'Psalm': 'Psalms',
  'Psalms': 'Psalms',
};

function parseCSV(raw) {
  const lines = raw.trim().split('\n').slice(1); // skip header
  return lines.map(line => {
    // Handle quoted fields — text may contain commas
    const m = line.match(/^([^,]+),(\d+),(\d+),(.*)$/s);
    if (!m) return null;
    const [, rawBook, c, v, text] = m;
    const bookName = NAME_FIX[rawBook.trim()] ?? rawBook.trim();
    return {
      bookName,
      chapter: parseInt(c),
      verse:   parseInt(v),
      text:    text.replace(/^"|"$/g, '').replace(/<[^>]+>/g, '').trim(),
    };
  }).filter(Boolean);
}

async function importTranslation(t, bookMap) {
  console.log(`\n── ${t.label} ──`);
  console.log(`Fetching ${t.url} ...`);

  const res = await fetch(t.url);
  if (!res.ok) {
    console.error(`  ✗ HTTP ${res.status} — skipping`);
    return;
  }
  const raw = await res.text();
  const parsed = parseCSV(raw);

  const verses = parsed.map(p => ({
    book_id:     bookMap[p.bookName],
    chapter:     p.chapter,
    verse:       p.verse,
    text:        p.text,
    translation: t.key,
  })).filter(v => v.book_id !== undefined && !isNaN(v.chapter) && v.text);

  const skipped = parsed.length - verses.length;
  console.log(`  Parsed ${parsed.length} rows → ${verses.length} valid (${skipped} skipped)`);

  // Check if already imported
  const { count } = await supabase
    .from('verses').select('id', { count: 'exact', head: true })
    .eq('translation', t.key);
  if (count > 0) {
    console.log(`  Already have ${count} rows for ${t.key} — deleting first...`);
    await supabase.from('verses').delete().eq('translation', t.key);
  }

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('verses').insert(batch);
    if (error) { console.error(`  ✗ Batch error:`, error.message); process.exit(1); }
    const pct = Math.round(((i + batch.length) / verses.length) * 100);
    process.stdout.write(`\r  ${pct}% (${i + batch.length}/${verses.length})`);
  }
  console.log(`\n  ✓ Done`);
}

async function main() {
  const target = process.argv[2]?.toLowerCase();
  const toRun = target ? TRANSLATIONS.filter(t => t.key === target) : TRANSLATIONS;
  if (toRun.length === 0) {
    console.error(`Unknown translation: ${target}`);
    console.error(`Valid keys: ${TRANSLATIONS.map(t => t.key).join(', ')}`);
    process.exit(1);
  }

  const { data: books, error: booksErr } = await supabase.from('books').select('id, name');
  if (booksErr) throw new Error(booksErr.message);
  const bookMap = Object.fromEntries(books.map(b => [b.name, b.id]));

  for (const t of toRun) {
    await importTranslation(t, bookMap);
  }

  console.log('\nAll done!');
}

main().catch(err => { console.error(err); process.exit(1); });
