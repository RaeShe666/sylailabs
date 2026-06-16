-- L1 fragment distillation cursor (persona-v2 §5.2).
-- last_distilled_at marks how far this instance's memory distillation has read;
-- messages after it are the "new segment" for the next L1 run.

alter table public.chirp_persona_instances
  add column if not exists last_distilled_at timestamptz;
