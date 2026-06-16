-- M1 persona record loader support.
-- persona_key is the stable runtime key used by routes and planet membership
-- (for example: danzong, barry, duck). The row id remains the database id.

alter table public.chirp_personas
  add column if not exists persona_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists chirp_personas_creator_key_idx
  on public.chirp_personas(creator_id, persona_key)
  where persona_key is not null;

create index if not exists chirp_personas_persona_key_idx
  on public.chirp_personas(persona_key);

