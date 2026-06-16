-- RLS predates conversations: chirp_messages was only readable by planet
-- ownership (planet_id IN my planets), so DM messages (planet_id null) were
-- invisible to the frontend — DM history vanished on reload and DM list
-- previews showed empty. Add read access for messages of conversations the
-- user owns. Additive (SELECT policies are OR'd); does not widen anyone else's
-- access.
drop policy if exists "Users can read messages of own conversations" on chirp_messages;
create policy "Users can read messages of own conversations"
  on chirp_messages for select
  using (
    conversation_id in (select id from chirp_conversations where owner_id = auth.uid())
  );
