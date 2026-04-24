import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://klrvxlltgeibglszsezq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY before running stack-admin.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function usage() {
  console.log(`
Usage:
  node stack-admin.js check
  node stack-admin.js list --email you@example.com
  node stack-admin.js dump --email you@example.com
  node stack-admin.js search --query "fear not" [--translation kjv] [--limit 10]
  node stack-admin.js add-refs --email you@example.com --stack "Promises" --ref "John 3:16" [--ref "Psalm 23:1-4"] [--translation kjv]

Notes:
  - add-refs creates the stack if it does not exist.
  - single verse refs become one-card entries.
  - verse ranges become grouped passage cards.
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (args[key] == null) {
      args[key] = next;
    } else if (Array.isArray(args[key])) {
      args[key].push(next);
    } else {
      args[key] = [args[key], next];
    }
    i += 1;
  }
  return args;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePassage(passage) {
  if (!passage) return null;
  const ref = String(passage.ref || '').trim();
  const text = String(passage.text || '').trim();
  if (!ref || !text) return null;
  return { ref, text };
}

function normalizeCard(card) {
  const passages = Array.isArray(card?.passages)
    ? card.passages.map(normalizePassage).filter(Boolean)
    : [];
  if (!passages.length) return null;
  return {
    passages,
    note: String(card?.note || ''),
    addedAt: Number(card?.addedAt) || Date.now()
  };
}

function normalizeStacks(stacks) {
  if (!Array.isArray(stacks)) return [];
  return stacks.map((stack, idx) => ({
    id: String(stack?.id || `${Date.now().toString(36)}${idx}`),
    title: String(stack?.title || `Stack ${idx + 1}`),
    verses: Array.isArray(stack?.verses) ? stack.verses.map(normalizeCard).filter(Boolean) : [],
    createdAt: Number(stack?.createdAt) || Date.now(),
    updatedAt: Number(stack?.updatedAt) || Number(stack?.createdAt) || Date.now()
  }));
}

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 200) break;
  }
  return users;
}

async function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) throw new Error('Email is required');
  const users = await listAllUsers();
  const user = users.find(entry => String(entry.email || '').toLowerCase() === target);
  if (!user) throw new Error(`No Supabase auth user found for ${email}`);
  return user;
}

async function ensureBooks() {
  const { data, error } = await supabase.from('books').select('id, name');
  if (error) throw error;
  return new Map(data.map(book => [book.name.toLowerCase(), book]));
}

async function loadStackRow(userId) {
  const { data, error } = await supabase
    .from('user_stack_state')
    .select('user_id, stacks, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadUserStacksByEmail(email) {
  const user = await findUserByEmail(email);
  const row = await loadStackRow(user.id);
  return {
    user,
    stacks: normalizeStacks(row?.stacks || [])
  };
}

async function saveUserStacks(userId, stacks) {
  const payload = normalizeStacks(stacks).map(stack => ({
    ...stack,
    updatedAt: Number(stack.updatedAt) || Date.now()
  }));
  const { error } = await supabase
    .from('user_stack_state')
    .upsert({
      user_id: userId,
      stacks: payload,
      updated_at: new Date().toISOString()
    });
  if (error) throw error;
}

function parseReference(rawRef, booksByName) {
  const ref = String(rawRef || '').trim().replace(/\s+/g, ' ');
  const match = ref.match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!match) throw new Error(`Invalid reference: ${rawRef}`);

  const [, rawBookName, rawChapter, rawStartVerse, rawEndVerse] = match;
  const book = booksByName.get(rawBookName.toLowerCase());
  if (!book) throw new Error(`Unknown book: ${rawBookName}`);

  const chapter = Number(rawChapter);
  const verseStart = Number(rawStartVerse);
  const verseEnd = rawEndVerse ? Number(rawEndVerse) : verseStart;
  if (!chapter || !verseStart || !verseEnd || verseEnd < verseStart) {
    throw new Error(`Invalid verse range: ${rawRef}`);
  }

  return { book, chapter, verseStart, verseEnd };
}

async function fetchPassages(rawRef, translation, booksByName) {
  const parsed = parseReference(rawRef, booksByName);
  const { data, error } = await supabase
    .from('verses')
    .select('verse, text')
    .eq('book_id', parsed.book.id)
    .eq('chapter', parsed.chapter)
    .eq('translation', translation)
    .gte('verse', parsed.verseStart)
    .lte('verse', parsed.verseEnd)
    .order('verse');
  if (error) throw error;
  if (!data?.length) throw new Error(`No verses found for ${rawRef} in ${translation.toUpperCase()}`);

  return data.map(row => ({
    ref: `${parsed.book.name} ${parsed.chapter}:${row.verse}`,
    text: row.text
  }));
}

function countPassages(stack) {
  return (stack?.verses || []).reduce((sum, card) => sum + (card.passages?.length || 0), 0);
}

function findOrCreateStack(stacks, title) {
  const target = String(title || '').trim();
  if (!target) throw new Error('Stack title is required');
  const existing = stacks.find(stack => stack.title.toLowerCase() === target.toLowerCase());
  if (existing) return existing;

  const stamp = Date.now();
  const next = {
    id: `${stamp.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: target,
    verses: [],
    createdAt: stamp,
    updatedAt: stamp
  };
  stacks.push(next);
  return next;
}

async function runCheck() {
  try {
    const { error } = await supabase.from('user_stack_state').select('user_id').limit(1);
    if (error) throw error;
    console.log('user_stack_state exists and is reachable.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

async function runList(email) {
  const { user, stacks } = await loadUserStacksByEmail(email);
  console.log(`${user.email} (${user.id})`);
  if (!stacks.length) {
    console.log('No stacks found.');
    return;
  }
  stacks.forEach(stack => {
    console.log(`- ${stack.title}: ${stack.verses.length} cards, ${countPassages(stack)} passages`);
  });
}

async function runDump(email) {
  const { user, stacks } = await loadUserStacksByEmail(email);
  console.log(JSON.stringify({ email: user.email, userId: user.id, stacks }, null, 2));
}

async function runSearch(query, translation = 'kjv', limit = 10) {
  const { data, error } = await supabase
    .from('verses')
    .select('chapter, verse, text, books(name)')
    .eq('translation', translation)
    .ilike('text', `%${query}%`)
    .limit(limit);
  if (error) throw error;

  if (!data?.length) {
    console.log('No verses found.');
    return;
  }

  data.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.books.name} ${row.chapter}:${row.verse} - ${row.text}`);
  });
}

async function runAddRefs(email, stackTitle, refs, translation = 'kjv') {
  if (!refs.length) throw new Error('At least one --ref is required');

  const booksByName = await ensureBooks();
  const { user, stacks } = await loadUserStacksByEmail(email);
  const stack = findOrCreateStack(stacks, stackTitle);

  const added = [];
  for (const ref of refs) {
    const passages = await fetchPassages(ref, translation, booksByName);
    const firstRef = passages[0]?.ref;
    if (stack.verses.some(card => card.passages?.[0]?.ref === firstRef)) {
      continue;
    }
    stack.verses.push({
      passages,
      note: '',
      addedAt: Date.now()
    });
    added.push(ref);
  }

  stack.updatedAt = Date.now();
  await saveUserStacks(user.id, stacks);
  console.log(`Saved ${added.length} reference(s) to "${stack.title}" for ${user.email}.`);
  if (added.length) added.forEach(ref => console.log(`- ${ref}`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === 'help' || command === '--help') {
    usage();
    return;
  }

  try {
    if (command === 'check') {
      await runCheck();
      return;
    }
    if (command === 'list') {
      await runList(args.email);
      return;
    }
    if (command === 'dump') {
      await runDump(args.email);
      return;
    }
    if (command === 'search') {
      await runSearch(args.query, args.translation || 'kjv', Number(args.limit) || 10);
      return;
    }
    if (command === 'add-refs') {
      await runAddRefs(args.email, args.stack, asArray(args.ref), args.translation || 'kjv');
      return;
    }

    usage();
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

main();
