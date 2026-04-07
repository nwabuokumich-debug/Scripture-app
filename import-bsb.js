// Run: SUPABASE_SERVICE_KEY=your_key node import-bsb.js
// Make sure you've run migration-add-translation.sql first

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Set SUPABASE_SERVICE_KEY env var'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BSB_CSV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv/BSB.csv';

const BATCH_SIZE = 500;

async function main() {
  const { data: books, error: booksErr } = await supabase.from('books').select('id, name');
  if (booksErr) throw new Error(`Failed to fetch books: ${booksErr.message}`);
  const bookMap = Object.fromEntries(books.map(b => [b.name, b.id]));

  const nameFix = {
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
    'Psalm': 'Psalms',
  };

  console.log('Fetching BSB data...');
  const res = await fetch(BSB_CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const raw = await res.text();

  const lines = raw.trim().split('\n').slice(1);
  console.log(`Parsing ${lines.length} verses...`);

  const verses = lines.map(line => {
    const [rawName, c, v, ...rest] = line.split(',');
    const bookName = nameFix[rawName.trim()] ?? rawName.trim();
    const book_id = bookMap[bookName];
    return {
      book_id,
      chapter: parseInt(c),
      verse:   parseInt(v),
      text:    rest.join(',').replace(/^"|"$/g, '').trim(),
      translation: 'bsb',
    };
  }).filter(v => v.book_id !== undefined && !isNaN(v.chapter));

  console.log(`Inserting ${verses.length} BSB verses in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('verses').insert(batch);
    if (error) {
      console.error(`Error at batch ${i}:`, error.message);
      process.exit(1);
    }
    const pct = Math.round(((i + batch.length) / verses.length) * 100);
    process.stdout.write(`\r${pct}% (${i + batch.length}/${verses.length})`);
  }

  console.log('\nDone! All BSB verses imported.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
