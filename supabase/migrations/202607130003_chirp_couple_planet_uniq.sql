-- 每用户最多一个 couple planet：防并发双 POST /chirp/couple/invite 建出两个
-- （否则两张邀请码各自可兑，伴侣可能加进"另一个"couple planet）
do $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.chirp_planets
    where type = 'couple' group by owner_id having count(*) > 1 limit 1;
  if v_owner is not null then
    raise exception 'DUPLICATE_COUPLE_PLANETS_FOR_OWNER %', v_owner;
  end if;
end $$;

create unique index if not exists chirp_planets_one_couple_per_owner
  on public.chirp_planets (owner_id) where (type = 'couple');
