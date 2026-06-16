-- M1 recall search substrate.
-- Runtime recall is scope-first: queries must filter allowed conversations before
-- ranking. These columns/indexes make direct message recall cheap enough for M1.

create extension if not exists vector with schema extensions;

alter table public.chirp_messages
  add column if not exists search_vector tsvector
    generated always as (to_tsvector('simple', coalesce(text, ''))) stored,
  add column if not exists message_embedding vector(1536);

create index if not exists chirp_messages_search_vector_idx
  on public.chirp_messages using gin(search_vector);

create index if not exists chirp_messages_embedding_idx
  on public.chirp_messages using ivfflat (message_embedding vector_cosine_ops)
  with (lists = 100)
  where message_embedding is not null;
