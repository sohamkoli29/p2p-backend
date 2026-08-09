-- Extends Supabase auth.users with role + role-specific info
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  department text,        -- used by 'alemic' role
  company_name text,      -- used by 'vendor' role
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new user signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'alemic'),
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed User')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();