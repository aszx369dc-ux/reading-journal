create table if not exists public.reading_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reading_entries_user_date_key unique (user_id, entry_date)
);

create index if not exists reading_entries_user_date_idx
  on public.reading_entries (user_id, entry_date desc);

create or replace function public.set_reading_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reading_entries_updated_at on public.reading_entries;
create trigger reading_entries_updated_at
before update on public.reading_entries
for each row execute function public.set_reading_entries_updated_at();

alter table public.reading_entries enable row level security;

revoke all on table public.reading_entries from anon;
grant select, insert, update, delete on table public.reading_entries to authenticated;

drop policy if exists "Users can read their own entries" on public.reading_entries;
create policy "Users can read their own entries"
on public.reading_entries for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own entries" on public.reading_entries;
create policy "Users can insert their own entries"
on public.reading_entries for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own entries" on public.reading_entries;
create policy "Users can update their own entries"
on public.reading_entries for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own entries" on public.reading_entries;
create policy "Users can delete their own entries"
on public.reading_entries for delete to authenticated
using (auth.uid() = user_id);
