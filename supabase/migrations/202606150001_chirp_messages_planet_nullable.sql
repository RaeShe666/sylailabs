-- DM messages (persona_dm / bird_dm) are planet-independent and carry no
-- planet_id. The legacy chirp_messages.planet_id was NOT NULL (it predates
-- conversations), which made every DM message insert fail with 23502. Allow null.
alter table public.chirp_messages alter column planet_id drop not null;
