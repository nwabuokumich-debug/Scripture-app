-- Upgrade semantic search embeddings from KJV-only rows to per-translation rows.
-- Run this once before embedding a modern-English translation such as BSB.

create extension if not exists vector;

alter table verse_embeddings
  add column if not exists translation text not null default 'kjv';

alter table verse_embeddings
  drop constraint if exists verse_embeddings_pkey;

alter table verse_embeddings
  add primary key (translation, book_id, chapter, verse);

create index if not exists idx_verse_embeddings_translation
  on verse_embeddings (translation);

create index if not exists idx_verse_embeddings_hnsw
  on verse_embeddings
  using hnsw (embedding vector_cosine_ops);

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
  with nearest_embedding_rows as (
    select
      ve.book_id,
      ve.chapter,
      ve.verse,
      ve.embedding <=> query_embedding as distance
    from verse_embeddings ve
    order by ve.embedding <=> query_embedding
    limit greatest(match_count * 12, 180)
  ),
  semantic_matches as (
    select
      book_id,
      chapter,
      verse,
      min(distance) as distance
    from nearest_embedding_rows
    group by book_id, chapter, verse
    order by min(distance)
    limit match_count
  )
  select
    v.book_id,
    b.name as book_name,
    v.chapter,
    v.verse,
    v.text,
    (1 - sm.distance)::real as similarity
  from semantic_matches sm
  join verses v
    on v.book_id = sm.book_id
   and v.chapter = sm.chapter
   and v.verse   = sm.verse
   and v.translation = target_translation
  join books b on b.id = v.book_id
  order by sm.distance;
$$;

grant execute on function search_verses_semantic(vector, int, text) to anon, authenticated;
