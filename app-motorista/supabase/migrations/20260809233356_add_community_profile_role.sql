alter table community_profiles
  add column role text not null default 'member'
  check (role in ('member', 'founder'));

update community_profiles
  set role = 'founder'
  where user_id = 'db85eea7-8cd7-464d-ba68-05f1e8a15560';
