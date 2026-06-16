-- Collapse the chat 'memo' sender_type into 'user' + is_personal_record.
-- No-@ chat/DM messages were stored as sender_type='memo' (sender_id null),
-- which overloaded "who sent it" with "was it directed" and made every
-- is-this-the-user check silently skip them. They are now plain 'user' rows,
-- flagged via is_personal_record. The Moments diary keeps using 'memo'
-- (sender_id like 'moment:%'), so it is explicitly excluded.
update chirp_messages
set sender_type = 'user',
    sender_id = 'user',
    sender_role = 'user',
    is_personal_record = true
where sender_type = 'memo'
  and coalesce(sender_id, '') not like 'moment:%';
