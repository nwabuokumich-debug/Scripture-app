-- Semantic search: pgvector + verse embeddings + RPC
-- Run this in the Supabase SQL editor once.

create extension if not exists vector;

create table if not exists verse_embeddings (
  book_id   integer not null,
  chapter   integer not null,
  verse     integer not null,
  embedding vector(384) not null,
  primary key (book_id, chapter, verse)
);

-- HNSW index for fast cosine-similarity nearest-neighbor search
create index if not exists idx_verse_embeddings_hnsw
  on verse_embeddings
  using hnsw (embedding vector_cosine_ops);

-- Public read of embeddings is fine (same as verses table)
alter table verse_embeddings enable row level security;
drop policy if exists "verse_embeddings public read" on verse_embeddings;
create policy "verse_embeddings public read"
  on verse_embeddings for select
  using (true);

-- RPC: take a query embedding, return the top N most-similar verses
-- in the requested translation, joined back to the verses table.
create or replace function search_verses_semantic(
  query_embedding vector(384),
  match_count     int  default 30,
  target_translation text default 'kjv'
)
returns table (
  book_id    integer,
  book_name  text,
  chapter    integer,
  verse      integer,
  text       text,
  similarity real
)
language sql
stable
as $$
  select
    v.book_id,
    b.name as book_name,
    v.chapter,
    v.verse,
    v.text,
    (1 - (ve.embedding <=> query_embedding))::real as similarity
  from verse_embeddings ve
  join verses v
    on v.book_id = ve.book_id
   and v.chapter = ve.chapter
   and v.verse   = ve.verse
   and v.translation = target_translation
  join books b on b.id = v.book_id
  order by ve.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function search_verses_semantic(vector, int, text) to anon, authenticated;
