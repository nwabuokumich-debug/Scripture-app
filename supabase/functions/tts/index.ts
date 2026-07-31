// Edge Function: render a verse to speech, cache it in Storage, return its URL.
//
// The app fetches the public Storage URL directly first — a verse that has
// already been rendered never reaches this function at all. This only runs on
// a genuine cache miss, so it costs one OpenAI call per verse, ever.
//
// The OpenAI key lives here, never in the browser (GitHub Pages is public).
//
// Env required (set via `supabase secrets set`):
//   OPENAI_API_KEY
// Injected automatically by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'scripture-audio';
const MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'marin';
const MAX_CHARS = 1200; // longest verse in the KJV is ~530; this is generous

const INSTRUCTIONS =
  'Read slowly and reverently, unhurried, with warmth and gravity. ' +
  'Observe the punctuation: pause at colons and semicolons. ' +
  'Do not dramatize or perform; read as a trusted narrator would.';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Must match slugForRef() in voice.js and render-audio.mjs.
function slugForRef(ref: string): string {
  return ref.trim().replace(/\s+/g, '-').replace(/:/g, '-');
}

// "1 Samuel 20:33" -> { book: "1 Samuel", chapter: 20, verse: 33 }
function parseRef(ref: string) {
  const m = ref.trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return null;
  return { book: m[1].trim(), chapter: Number(m[2]), verse: Number(m[3]) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) return json({ error: 'OPENAI_API_KEY not configured' }, 500);

  let body: { ref?: string; translation?: string; voice?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad JSON' }, 400); }

  const ref = (body.ref || '').toString();
  const translation = (body.translation || 'kjv').toString().toLowerCase();
  const voice = (body.voice || DEFAULT_VOICE).toString();

  const parsed = parseRef(ref);
  if (!parsed) return json({ error: `unparseable ref: ${ref}` }, 400);
  if (!/^[a-z0-9_-]{1,16}$/.test(translation)) return json({ error: 'bad translation' }, 400);
  if (!/^[a-z]{1,20}$/.test(voice)) return json({ error: 'bad voice' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const objectPath = `${translation}/${slugForRef(ref)}.mp3`;
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

  // Someone may have rendered it between the client's probe and now.
  const { data: existing } = await supabase.storage
    .from(BUCKET)
    .list(translation, { search: `${slugForRef(ref)}.mp3`, limit: 1 });
  if (existing?.length) return json({ url: publicUrl, cached: true });

  // Take the text from the database, never from the request. This function
  // spends money and is publicly callable, so it must only ever be able to
  // synthesize actual scripture — not arbitrary text handed to it.
  const { data: books } = await supabase
    .from('books').select('id').ilike('name', parsed.book).limit(1);
  if (!books?.length) return json({ error: `unknown book: ${parsed.book}` }, 400);

  const { data: verses } = await supabase
    .from('verses')
    .select('text')
    .eq('book_id', books[0].id)
    .eq('chapter', parsed.chapter)
    .eq('verse', parsed.verse)
    .eq('translation', translation)
    .limit(1);

  const text = verses?.[0]?.text?.trim();
  if (!text) return json({ error: `verse not found: ${ref} (${translation})` }, 404);
  if (text.length > MAX_CHARS) return json({ error: 'verse too long' }, 400);

  const speech = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: text,
      instructions: INSTRUCTIONS,
      response_format: 'mp3',
    }),
  });

  if (!speech.ok) {
    return json({ error: `openai ${speech.status}: ${await speech.text()}` }, 502);
  }

  const bytes = new Uint8Array(await speech.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType: 'audio/mpeg',
      cacheControl: '31536000', // immutable: a rendered verse never changes
      upsert: true,
    });

  if (upErr) return json({ error: `storage: ${upErr.message}` }, 500);

  return json({ url: publicUrl, cached: false, bytes: bytes.length });
});
