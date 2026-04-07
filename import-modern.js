// Run: SUPABASE_SERVICE_KEY=your_key node import-modern.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://klrvxlltgeibglszsezq.supabase.co', process.env.SUPABASE_SERVICE_KEY);
const BASE = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv';
const TRANSLATIONS = ['AKJV','UKJV','LITV','MKJV','CPDV'];
const BATCH = 500;
const NAME_FIX = {
  'I Samuel':'1 Samuel','II Samuel':'2 Samuel','I Kings':'1 Kings','II Kings':'2 Kings',
  'I Chronicles':'1 Chronicles','II Chronicles':'2 Chronicles','I Corinthians':'1 Corinthians',
  'II Corinthians':'2 Corinthians','I Thessalonians':'1 Thessalonians','II Thessalonians':'2 Thessalonians',
  'I Timothy':'1 Timothy','II Timothy':'2 Timothy','I Peter':'1 Peter','II Peter':'2 Peter',
  'I John':'1 John','II John':'2 John','III John':'3 John',
  'Revelation of John':'Revelation','Song of Songs':'Song of Solomon','Psalm':'Psalms'
};

const { data: books } = await supabase.from('books').select('id,name');
const bookMap = Object.fromEntries(books.map(b => [b.name, b.id]));

for (const t of TRANSLATIONS) {
  console.log('\n──', t);
  const res = await fetch(`${BASE}/${t}.csv`);
  if (!res.ok) { console.log('  404 skip'); continue; }
  const lines = (await res.text()).trim().split('\n').slice(1);
  const verses = lines.map(line => {
    const m = line.match(/^([^,]+),(\d+),(\d+),(.*)$/s);
    if (!m) return null;
    const bookName = NAME_FIX[m[1].trim()] ?? m[1].trim();
    return {
      book_id: bookMap[bookName], chapter: parseInt(m[2]), verse: parseInt(m[3]),
      text: m[4].replace(/^"|"$/g, '').replace(/<[^>]+>/g, '').trim(),
      translation: t.toLowerCase()
    };
  }).filter(v => v && v.book_id && !isNaN(v.chapter) && v.text);
  console.log(`  ${verses.length} verses`);
  for (let i = 0; i < verses.length; i += BATCH) {
    const { error } = await supabase.from('verses').insert(verses.slice(i, i + BATCH));
    if (error) { console.error(error.message); process.exit(1); }
    process.stdout.write(`\r  ${Math.round((i + Math.min(BATCH, verses.length - i)) / verses.length * 100)}%`);
  }
  console.log('\n  ✓ done');
}
console.log('\nAll done!');
