-- APPRENTI.CH — PostgreSQL schema for Supabase
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', age smallint check (age between 14 and 99),
  location text not null default '', canton text not null default 'Fribourg',
  goal text not null default '', language text not null default 'Français',
  education text not null default '', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cv','letter')), title text not null,
  storage_path text not null, mime_type text not null, size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  company text not null, trade text not null, email text, status text not null default 'À examiner'
    check(status in ('À examiner','À préparer','Prête à envoyer','Envoyée','En attente','Entretien obtenu','Refusée','Acceptée')),
  sent_at timestamptz, message text, cv_document_id uuid references public.documents(id) on delete set null,
  letter_document_id uuid references public.documents(id) on delete set null,
  source_url text, notes text not null default '', reminder_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.letter_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, body text not null, created_at timestamptz not null default now()
);
-- Only populate this table from a source whose reuse is authorized in writing.
create table if not exists public.job_offers (
  id text primary key, company text not null, trade text not null, canton text not null,
  location text not null default '', description text not null default '', start_year smallint,
  published_at timestamptz, deadline timestamptz, source_url text not null,
  source_email text, source_email_verified boolean not null default false,
  source_name text not null, is_active boolean not null default true,
  refreshed_at timestamptz not null default now(),
  check (source_url like 'https://%'),
  check (source_email is null or source_email_verified = true)
);

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.applications enable row level security;
alter table public.letter_versions enable row level security;
alter table public.job_offers enable row level security;
create policy "own profile select" on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy "own profile insert" on public.profiles for insert to authenticated with check ((select auth.uid())=id);
create policy "own profile update" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy "own documents all" on public.documents for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "own applications all" on public.applications for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "own letter versions all" on public.letter_versions for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "published offers readable" on public.job_offers for select to anon, authenticated using (is_active = true);
grant select on public.job_offers to anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('private-documents','private-documents',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
create policy "user reads own files" on storage.objects for select to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "user uploads own files" on storage.objects for insert to authenticated with check (bucket_id='private-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "user replaces own files" on storage.objects for update to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='private-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "user deletes own files" on storage.objects for delete to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Do not add a service_role key to the static site. Add updated_at triggers if desired.
