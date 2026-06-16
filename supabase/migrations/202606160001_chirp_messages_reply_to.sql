-- Persist the quoted-reply snapshot on a message so the "replying to …" line
-- survives reload. Stores the display snapshot the user saw: { id, author, text }.
-- The model still resolves the quoted text fresh by id (loadQuotedContext); this
-- column is purely for rendering the quote chip above the bubble.

alter table public.chirp_messages
  add column if not exists reply_to jsonb;
