-- One-off access fix for Landon Nelson.
-- Run after supabase/auth_access_model.sql has been applied.

do $$
declare
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where lower(email) = 'landon.nelson@redstoneresidential.com'
  limit 1;

  if target_user_id is null then
    raise notice 'No auth.users row found for landon.nelson@redstoneresidential.com. Create or invite the user first, then rerun this block.';
    return;
  end if;

  insert into public.profiles (id, email, full_name, global_role, is_active)
  values (
    target_user_id,
    'landon.nelson@redstoneresidential.com',
    'Landon Nelson',
    'admin',
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
        else public.profiles.full_name
      end,
      global_role = 'admin',
      is_active = true;
end $$;
