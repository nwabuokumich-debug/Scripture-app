// Imports WEB (World English Bible) and DRA (Douay-Rheims) into Supabase
// Run: SUPABASE_SERVICE_KEY=your_key node import-web-dra.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Set SUPABASE_SERVICE_KEY env var'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BATCH_SIZE = 500;

// OSIS book IDs → canonical names matching our DB
const OSIS_TO_NAME = {
  GEN:'Genesis',EXO:'Exodus',LEV:'Leviticus',NUM:'Numbers',DEU:'Deuteronomy',
  JOS:'Joshua',JDG:'Judges',RUT:'Ruth','1SA':'1 Samuel','2SA':'2 Samuel',
  '1KI':'1 Kings','2KI':'2 Kings','1CH':'1 Chronicles','2CH':'2 Chronicles',
  EZR:'Ezra',NEH:'Nehemiah',EST:'Esther',JOB:'Job',PSA:'Psalms',PRO:'Proverbs',
  ECC:'Ecclesiastes',SNG:'Song of Solomon',ISA:'Isaiah',JER:'Jeremiah',
  LAM:'Lamentations',EZK:'Ezekiel',DAN:'Daniel',HOS:'Hosea',JOL:'Joel',
  AMO:'Amos',OBA:'Obadiah',JON:'Jonah',MIC:'Micah',NAM:'Nahum',HAB:'Habakkuk',
  ZEP:'Zephaniah',HAG:'Haggai',ZEC:'Zechariah',MAL:'Malachi',
  MAT:'Matthew',MRK:'Mark',LUK:'Luke',JHN:'John',ACT:'Acts',ROM:'Romans',
  '1CO':'1 Corinthians','2CO':'2 Corinthians',GAL:'Galatians',EPH:'Ephesians',
  PHP:'Philippians',COL:'Colossians','1TH':'1 Thessalonians','2TH':'2 Thessalonians',
  '1TI':'1 Timothy','2TI':'2 Timothy',TIT:'Titus',PHM:'Philemon',
  HEB:'Hebrews',JAS:'James','1PE':'1 Peter','2PE':'2 Peter',
  '1JN':'1 John','2JN':'2 John','3JN':'3 John',JUD:'Jude',REV:'Revelation',
};

// Zefania XML book name fixes
const ZEF_NAME_FIX = {
  'Song of Songs': 'Song of Solomon',
  'Psalm': 'Psalms', 'Psalms': 'Psalms',
  'Revelation': 'Revelation',
  '1 Samuel': '1 Samuel', '2 Samuel': '2 Samuel',
  '1 Kings': '1 Kings', '2 Kings': '2 Kings',
  '1 Chronicles': '1 Chronicles', '2 Chronicles': '2 Chronicles',
  '1 Corinthians': '1 Corinthians', '2 Corinthians': '2 Corinthians',
  '1 Thessalonians': '1 Thessalonians', '2 Thessalonians': '2 Thessalonians',
  '1 Timothy': '1 Timothy', '2 Timothy': '2 Timothy',
  '1 Peter': '1 Peter', '2 Peter': '2 Peter',
  '1 John': '1 John', '2 John': '2 John', '3 John': '3 John',
};

// Parse Zefania XML (used by DRA)
function parseZefania(xml) {
  const result = [];
  const bookRx = /<BIBLEBOOK[^>]+bname="([^"]+)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/g;
  let bm;
  while ((bm = bookRx.exec(xml)) !== null) {
    const rawName = bm[1].trim();
    const bookName = ZEF_NAME_FIX[rawName] ?? rawName;
    const bookContent = bm[2];
    const chapRx = /<CHAPTER[^>]+cnumber="(\d+)"[^>]*>([\s\S]*?)<\/CHAPTER>/g;
    let cm;
    while ((cm = chapRx.exec(bookContent)) !== null) {
      const chapter = parseInt(cm[1]);
      const chapContent = cm[2];
      const versRx = /<VERS[^>]+vnumber="(\d+)"[^>]*>([\s\S]*?)<\/VERS>/g;
      let vm;
      while ((vm = versRx.exec(chapContent)) !== null) {
        const verse = parseInt(vm[1]);
        const text = vm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text) result.push({ bookName, chapter, verse, text });
      }
    }
  }
  return result;
}

// Parse USFX XML (used by WEB)
function parseUsfx(xml) {
  const result = [];
  // Strip footnotes and cross-references
  let clean = xml
    .replace(/<f\b[^>]*>[\s\S]*?<\/f>/g, '')
    .replace(/<x\b[^>]*>[\s\S]*?<\/x>/g, '');

  const bookRx = /<book id="([A-Z0-9]+)">([\s\S]*?)(?=<book |$)/g;
  let bm;
  while ((bm = bookRx.exec(clean)) !== null) {
    const bookName = OSIS_TO_NAME[bm[1]];
    if (!bookName) continue;
    const bookContent = bm[2];

    // Split by chapter markers
    const chapParts = bookContent.split(/<c id="(\d+)"\/>/);
    for (let i = 1; i < chapParts.length; i += 2) {
      const chapter = parseInt(chapParts[i]);
      const chapContent = chapParts[i + 1] || '';
      const verseRx = /<v id="(\d+)"\/>([\s\S]*?)<ve\/>/g;
      let vm;
      while ((vm = verseRx.exec(chapContent)) !== null) {
        const verse = parseInt(vm[1]);
        const text = vm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text) result.push({ bookName, chapter, verse, text });
      }
    }
  }
  return result;
}

async function importVerses(key, parsed, bookMap) {
  const verses = parsed.map(p => ({
    book_id: bookMap[p.bookName],
    chapter: p.chapter,
    verse:   p.verse,
    text:    p.text,
    translation: key,
  })).filter(v => v.book_id !== undefined);

  const skipped = parsed.length - verses.length;
  console.log(`  Parsed ${parsed.length} → ${verses.length} valid (${skipped} skipped)`);

  // Clear existing
  const { count } = await supabase.from('verses').select('id', { count: 'exact', head: true }).eq('translation', key);
  if (count > 0) {
    console.log(`  Clearing ${count} existing rows...`);
    await supabase.from('verses').delete().eq('translation', key);
  }

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('verses').insert(batch);
    if (error) { console.error('Batch error:', error.message); process.exit(1); }
    const pct = Math.round(((i + batch.length) / verses.length) * 100);
    process.stdout.write(`\r  ${pct}% (${i + batch.length}/${verses.length})`);
  }
  console.log('\n  ✓ Done');
}

async function main() {
  const { data: books, error } = await supabase.from('books').select('id, name');
  if (error) throw error;
  const bookMap = Object.fromEntries(books.map(b => [b.name, b.id]));

  // ── WEB ──
  console.log('\n── WEB (World English Bible) ──');
  const webRes = await fetch('https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-web.usfx.xml');
  if (!webRes.ok) { console.error(`HTTP ${webRes.status}`); } else {
    const webXml = await webRes.text();
    const webParsed = parseUsfx(webXml);
    await importVerses('web', webParsed, bookMap);
  }

  // ── DRA ──
  console.log('\n── DRA (Douay-Rheims) ──');
  const draRes = await fetch('https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-dra.zefania.xml');
  if (!draRes.ok) { console.error(`HTTP ${draRes.status}`); } else {
    const draXml = await draRes.text();
    const draParsed = parseZefania(draXml);
    await importVerses('dra', draParsed, bookMap);
  }

  console.log('\nAll done!');
}

main().catch(err => { console.error(err); process.exit(1); });
