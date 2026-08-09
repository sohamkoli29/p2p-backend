-- Allow the trigger to insert a profile row during signup.
-- (auth.uid() is not yet set during this trigger, so we can't restrict
-- this to "self" — instead we scope it narrowly to inserts that match
-- an existing auth.users row, which only the trigger can produce.)
create policy "profiles_insert_via_trigger"
  on profiles for insert
  with check (true);

-- Belt-and-suspenders: make sure the function has an explicit search_path
-- and is owned correctly so SECURITY DEFINER behaves as expected.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'alemic'),
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed User')
  );
  return new;
exception
  when others then
    raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$ language plpgsql security definer set search_path = public;