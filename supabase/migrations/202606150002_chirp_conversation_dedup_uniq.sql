-- Conversations were being created non-idempotently (select-then-insert race
-- across the frontend + backend ensure paths, no unique constraint), producing
-- duplicate group / bird_dm / persona_dm rows. Move their messages onto the
-- earliest row, delete the duplicates, then add partial unique indexes so a
-- given (owner, planet) group / (owner, agent) DM / (owner) bird DM can only
-- ever have one conversation.

-- group: one per (owner, planet)
update chirp_messages m set conversation_id = r.keep_id
from (
  select id, first_value(id) over (partition by owner_id, planet_id order by created_at) keep_id,
         row_number() over (partition by owner_id, planet_id order by created_at) rn
  from chirp_conversations where type = 'group'
) r where m.conversation_id = r.id and r.rn > 1;

-- persona_dm: one per (owner, agent_id)
update chirp_messages m set conversation_id = r.keep_id
from (
  select id, first_value(id) over (partition by owner_id, metadata->>'agent_id' order by created_at) keep_id,
         row_number() over (partition by owner_id, metadata->>'agent_id' order by created_at) rn
  from chirp_conversations where type = 'persona_dm'
) r where m.conversation_id = r.id and r.rn > 1;

-- bird_dm: one per owner
update chirp_messages m set conversation_id = r.keep_id
from (
  select id, first_value(id) over (partition by owner_id order by created_at) keep_id,
         row_number() over (partition by owner_id order by created_at) rn
  from chirp_conversations where type = 'bird_dm'
) r where m.conversation_id = r.id and r.rn > 1;

-- delete the now-empty duplicate conversations
delete from chirp_conversations c using (
  select id from (
    select id,
      row_number() over (
        partition by owner_id,
          case when type='group' then planet_id::text
               when type='persona_dm' then metadata->>'agent_id'
               else '' end,
          type
        order by created_at
      ) rn
    from chirp_conversations
  ) t where rn > 1
) d where c.id = d.id;

create unique index if not exists chirp_conv_group_uniq
  on chirp_conversations (owner_id, planet_id) where type = 'group';
create unique index if not exists chirp_conv_persona_dm_uniq
  on chirp_conversations (owner_id, (metadata->>'agent_id')) where type = 'persona_dm';
create unique index if not exists chirp_conv_bird_dm_uniq
  on chirp_conversations (owner_id) where type = 'bird_dm';
