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
  with selected_embeddings as (
    select ve.*
    from verse_embeddings ve
    where ve.translation = target_translation
    union all
    select ve.*
    from verse_embeddings ve
    where ve.translation = 'kjv'
      and not exists (
        select 1
        from verse_embeddings target_ve
        where target_ve.translation = target_translation
        limit 1
      )
  )
  select
    v.book_id,
    b.name as book_name,
    v.chapter,
    v.verse,
    v.text,
    (1 - (ve.embedding <=> query_embedding))::real as similarity
  from selected_embeddings ve
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
