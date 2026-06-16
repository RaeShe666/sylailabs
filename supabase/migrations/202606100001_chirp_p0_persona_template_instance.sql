-- Chirp P0: persona template/instance foundation (persona-v2 §2).
-- template = public persona asset (no user privacy)
-- instance = per user×template private relationship copy
-- knowledge base = external tables referenced by template (P0: schema + recall seam)
-- interaction_event = per-turn ledger (no LLM), anchor for async distillation
--
-- Old per-user table public.chirp_personas is deprecated by this migration:
-- it stays readable for now but nothing should write to it anymore.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- ── persona_template ────────────────────────────────────────────────────────
-- P0 only implements catalog + build_asset(distilled_profile) + runtime_card.
-- Publish/rating/usage/saved-version fields are deliberately NOT pre-built
-- (persona-v2 §2 discipline: add them with their feature).

create table if not exists public.chirp_persona_templates (
  id uuid primary key default gen_random_uuid(),

  -- catalog (display/selection/routing; never injected into prompts)
  persona_key text unique,                  -- stable key for official personas ('danzong'...)
  name text not null,
  short_intro text not null default '',
  avatar_url text not null default '',
  color text not null default '#F5C878',
  creator_id uuid references auth.users(id) on delete set null,  -- null = official/system
  creator_type text not null default 'official'
    check (creator_type in ('official', 'user', 'community')),
  persona_kind text not null default 'original_companion'
    check (persona_kind in ('real_person_inspired', 'expert', 'original_companion')),
  model_preference text,                    -- for model router (§7); not injected
  visibility text not null default 'private' check (visibility in ('private', 'public')),

  -- build_asset (creator/server private; never injected; knowledge base lives in its own tables)
  distilled_profile jsonb not null default '{}'::jsonb,

  -- runtime_card (compiled short card; injected every turn into the stable layer)
  runtime_card jsonb not null default '{}'::jsonb,
  runtime_card_hash text not null default '',   -- compile hash for prompt-cache gating

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chirp_persona_templates_visibility_idx
  on public.chirp_persona_templates(visibility, is_active);

create index if not exists chirp_persona_templates_creator_idx
  on public.chirp_persona_templates(creator_id);

-- ── persona_instance ────────────────────────────────────────────────────────
-- All user privacy and "how this persona accompanies this user" lives here.
-- No bird_insight_digest column on purpose: global/long-term memory shape is
-- undecided (2026-06-10); insights stay in chirp_insights, filtered at read time.

create table if not exists public.chirp_persona_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.chirp_persona_templates(id) on delete cascade,

  user_personal_patch jsonb not null default '{}'::jsonb,   -- user sliders: directness/warmth/humor/reply_length/avoid_topics/address_style
  user_memory jsonb not null default '[]'::jsonb,           -- declarative: [{text, source_message_ids, confidence}]
  interaction_skill jsonb not null default '[]'::jsonb,     -- procedural: [{text, source_message_ids, confidence}]
  affective_context jsonb not null default '{}'::jsonb,     -- {summary, response_need, sensitivity, confidence, evidence_message_ids, expires_at}
  relationship_stage text,                                  -- M4 evolution slot

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, template_id)
);

create index if not exists chirp_persona_instances_user_idx
  on public.chirp_persona_instances(user_id);

-- ── persona knowledge base (persona-v2 §2.1.1; external, referenced by template) ──

create table if not exists public.chirp_persona_knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null unique references public.chirp_persona_templates(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.chirp_persona_sources (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references public.chirp_persona_knowledge_bases(id) on delete cascade,
  source_kind text not null check (source_kind in ('identity', 'domain')),
  type text not null,                       -- interview | transcript | book | methodology | case | ...
  title text not null,
  origin text not null default '',
  url_or_file text not null default '',
  copyright_scope text not null default '',
  reliability text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists chirp_persona_sources_kb_idx
  on public.chirp_persona_sources(knowledge_base_id, is_active);

-- embedding dimension 1536 is provisional (embedding provider not chosen yet);
-- the table is empty until ingestion, so the column can be recreated if the
-- chosen model uses a different dimension.
create table if not exists public.chirp_persona_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references public.chirp_persona_knowledge_bases(id) on delete cascade,
  source_id uuid references public.chirp_persona_sources(id) on delete set null,
  chunk_type text not null check (chunk_type in ('raw_excerpt', 'distilled_claim', 'framework', 'case_pattern', 'example_dialogue')),
  content text not null,
  tags text[] not null default '{}',
  source_refs text[] not null default '{}',
  embedding vector(1536),
  search_text tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists chirp_persona_knowledge_chunks_scope_idx
  on public.chirp_persona_knowledge_chunks(knowledge_base_id, is_active, chunk_type);

create index if not exists chirp_persona_knowledge_chunks_search_idx
  on public.chirp_persona_knowledge_chunks using gin(search_text);

create index if not exists chirp_persona_knowledge_chunks_embedding_idx
  on public.chirp_persona_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- ── interaction_event (persona-v2 §2.3: per-turn ledger, no LLM) ────────────
-- Visibility derives from conversation_members; not snapshotted here.

create table if not exists public.chirp_interaction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planet_id uuid references public.chirp_planets(id) on delete set null,
  conversation_id uuid references public.chirp_conversations(id) on delete cascade,
  conversation_type text not null check (conversation_type in ('group', 'persona_dm', 'bird_dm')),
  speaker_id text not null,                 -- 'user' | 'bird' | template persona_key/id
  message_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists chirp_interaction_events_user_idx
  on public.chirp_interaction_events(user_id, created_at);

create index if not exists chirp_interaction_events_conversation_idx
  on public.chirp_interaction_events(conversation_id, created_at);

-- ── membership: reference the new template object ───────────────────────────

alter table public.chirp_conversation_members
  add column if not exists template_id uuid references public.chirp_persona_templates(id) on delete set null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Backend uses the service role (bypasses RLS). Client policies:
--   templates: read public ones (or own) only — build assets stay server-side
--   instances: user manages own
--   knowledge/sources/chunks/events: no client policies = client cannot touch them

alter table public.chirp_persona_templates enable row level security;
alter table public.chirp_persona_instances enable row level security;
alter table public.chirp_persona_knowledge_bases enable row level security;
alter table public.chirp_persona_sources enable row level security;
alter table public.chirp_persona_knowledge_chunks enable row level security;
alter table public.chirp_interaction_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_persona_templates'
      and policyname = 'Users can read public or own persona templates'
  ) then
    create policy "Users can read public or own persona templates"
      on public.chirp_persona_templates
      for select
      using (visibility = 'public' or auth.uid() = creator_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_persona_instances'
      and policyname = 'Users can manage their own persona instances'
  ) then
    create policy "Users can manage their own persona instances"
      on public.chirp_persona_instances
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── seed official templates (placeholder content; real 诞总 assets come later) ──

insert into public.chirp_persona_templates
  (persona_key, name, short_intro, color, creator_type, persona_kind, visibility, runtime_card, runtime_card_hash)
values
  (
    'danzong',
    '诞总',
    '松弛、反鸡汤、轻轻拆穿式的朋友。聊感情里的拧巴最有一手。',
    '#E8A29C',
    'official',
    'real_person_inspired',
    'public',
    '{
      "identity_summary": "一个松弛、反鸡汤、会轻轻拆穿你的朋友（占位内容，待真实素材蒸馏后替换）。",
      "value_lens_summary": "先把过度用力的解释拆掉，再看事情本来的样子；不灌鸡汤，也不替人做决定。",
      "voice_rules": "短、松、具体。轻轻拆穿但不嘲讽人本身。用户脆弱时收锋芒、少讽刺。不演聪明，不把问候和小事上升成人生分析。",
      "core_framework": "（占位）感情里的多数痛苦来自「对解释的执念」，先分清事实和脑补。",
      "knows": "亲密关系里的拧巴、暧昧期的患得患失、自我安慰的套路。",
      "not_knows": "实时信息（天气/新闻）、医疗法律金融建议、用户没说过的事。超纲直接承认。",
      "memory_usage_rules": "自然地记得用户说过的事，不报告式引用；私聊里的私密内容不在群里主动提。",
      "content_status": "placeholder"
    }'::jsonb,
    'seed-placeholder-v1'
  ),
  (
    'barry',
    'Barry',
    '先接住你的情绪，再陪你看清楚一点。',
    '#EBA7B5',
    'official',
    'original_companion',
    'public',
    '{
      "identity_summary": "温热直接的陪伴者（占位内容，人设方向定了再写）。",
      "value_lens_summary": "情绪先于道理；先让人落地，再看一个不要过度脑补的点。",
      "voice_rules": "平实、温热、短。不糖水、不戏剧化、不诊断。",
      "core_framework": "（占位）",
      "knows": "（占位）",
      "not_knows": "实时信息、专业建议。超纲直接承认。",
      "memory_usage_rules": "自然带出记忆，不报告式引用。",
      "content_status": "placeholder"
    }'::jsonb,
    'seed-placeholder-v1'
  ),
  (
    'duck',
    'duck',
    '冷静的军师：拆事实、假设、证据和下一步。',
    '#A9C9DF',
    'official',
    'original_companion',
    'public',
    '{
      "identity_summary": "冷静清楚的策略军师（占位内容，人设方向定了再写）。",
      "value_lens_summary": "把事情拆成事实、假设、证据、下一步；不读心、不把小事上升。",
      "voice_rules": "清楚、实用、短。像朋友递纸笔，不像顾问做汇报。",
      "core_framework": "（占位）",
      "knows": "（占位）",
      "not_knows": "实时信息、专业建议。超纲直接承认。",
      "memory_usage_rules": "用户要分析时才把历史当证据用。",
      "content_status": "placeholder"
    }'::jsonb,
    'seed-placeholder-v1'
  )
on conflict (persona_key) do nothing;
