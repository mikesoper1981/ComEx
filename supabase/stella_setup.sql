-- =====================================================================
-- Stella Insights — Supabase setup (reference copy)
-- The app installs this automatically. Do not run it by hand.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Registry of every file Stella knows about (tabular datasets + docs).
-- org_id is 'company:<slug>:user:<userId>' so files never cross tenants.
-- Legacy rows used 'user:<userId>' or 'default' and are migrated on load.
-- ---------------------------------------------------------------------
create table if not exists public.stella_files (
  id           uuid primary key default gen_random_uuid(),
  org_id       text default 'default',
  file_name    text,
  file_type    text,
  storage_path text,
  table_name   text,
  columns      jsonb,
  row_count    integer,
  summary      text,
  context_qa   jsonb,
  uploaded_at  timestamptz default now()
);

alter table public.stella_files add column if not exists company_slug text;

update public.stella_files
  set company_slug = split_part(org_id, ':', 2)
  where org_id like 'company:%'
    and coalesce(company_slug, '') = '';

create index if not exists stella_files_company_slug_idx on public.stella_files (company_slug);
create index if not exists stella_files_org_id_idx on public.stella_files (org_id);

alter table public.stella_files enable row level security;
alter table public.stella_files force row level security;

create or replace function public.stella_request_company()
returns text
language plpgsql
stable
as $$
declare
  claims json;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::json;
  exception when others then
    claims := null;
  end;
  if claims is null then
    return null;
  end if;
  return nullif(btrim(coalesce(claims ->> 'company_slug', claims ->> 'company')), '');
end;
$$;

drop policy if exists "stella_files allow all" on public.stella_files;
drop policy if exists "stella_files company isolation" on public.stella_files;
create policy "stella_files company isolation"
  on public.stella_files
  for all
  to anon, authenticated
  using (
    coalesce(company_slug, '') <> ''
    and company_slug = public.stella_request_company()
  )
  with check (
    coalesce(company_slug, '') <> ''
    and company_slug = public.stella_request_company()
  );

-- ---------------------------------------------------------------------
-- Company schemas (c_pharmaco, c_comex, …) are created by the app via
-- stella_ensure_schema — never by running extra SQL per company.
-- ---------------------------------------------------------------------
create or replace function public.stella_ensure_schema(p_schema text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_schema is null or p_schema = 'public' then
    return;
  end if;
  if p_schema !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', p_schema;
  end if;
  execute format('create schema if not exists %I', p_schema);
  execute format('comment on schema %I is %L', p_schema, 'ComEx company tenant');
  begin
    execute format('revoke all on schema %I from public, anon, authenticated', p_schema);
  exception when others then
    null;
  end;
  begin
    execute format('grant usage on schema %I to service_role', p_schema);
  exception when others then
    null;
  end;
end;
$$;

create or replace function public.stella_create_table(p_table_name text, p_columns jsonb, p_schema text default 'public')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  col      jsonb;
  col_defs text := '';
  col_type text;
  sch      text := coalesce(nullif(btrim(p_schema), ''), 'public');
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  if sch <> 'public' and sch !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', sch;
  end if;
  perform public.stella_ensure_schema(sch);
  for col in select * from jsonb_array_elements(p_columns) loop
    col_type := case when lower(col->>'type') = 'numeric' then 'numeric' else 'text' end;
    col_defs := col_defs || format('%I %s, ', col->>'name', col_type);
  end loop;
  if col_defs = '' then
    raise exception 'No columns provided';
  end if;
  execute format('create table if not exists %I.%I (%s)', sch, p_table_name, rtrim(col_defs, ', '));
end;
$$;

create or replace function public.stella_insert_rows(p_table_name text, p_rows jsonb, p_schema text default 'public')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sch text := coalesce(nullif(btrim(p_schema), ''), 'public');
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  if sch <> 'public' and sch !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', sch;
  end if;
  execute format(
    'insert into %I.%I select * from jsonb_populate_recordset(null::%I.%I, $1)',
    sch, p_table_name, sch, p_table_name
  ) using p_rows;
end;
$$;

create or replace function public.stella_drop_table(p_table_name text, p_schema text default 'public')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sch text := coalesce(nullif(btrim(p_schema), ''), 'public');
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  if sch <> 'public' and sch !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', sch;
  end if;
  execute format('drop table if exists %I.%I', sch, p_table_name);
end;
$$;

create or replace function public.stella_run_select(query text, p_schema text default 'public')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result  jsonb;
  cleaned text := btrim(query);
  sch     text := coalesce(nullif(btrim(p_schema), ''), 'public');
begin
  if left(lower(cleaned), 6) <> 'select' then
    raise exception 'Only SELECT statements are allowed';
  end if;
  if position(';' in rtrim(cleaned, ';')) > 0 then
    raise exception 'Multiple statements are not allowed';
  end if;
  if sch <> 'public' and sch !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', sch;
  end if;
  perform set_config('search_path', sch, true);
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', rtrim(cleaned, ';'))
    into result;
  return result;
end;
$$;

create or replace function public.stella_move_table(p_table_name text, p_schema text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  if p_schema !~ '^c_[a-z0-9_]+$' then
    raise exception 'Invalid company schema: %', p_schema;
  end if;
  perform public.stella_ensure_schema(p_schema);
  if to_regclass(format('public.%I', p_table_name)) is not null
     and to_regclass(format('%I.%I', p_schema, p_table_name)) is null then
    execute format('alter table public.%I set schema %I', p_table_name, p_schema);
  end if;
end;
$$;

revoke all on function public.stella_ensure_schema(text) from public, anon, authenticated;
revoke all on function public.stella_create_table(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.stella_insert_rows(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.stella_drop_table(text, text) from public, anon, authenticated;
revoke all on function public.stella_run_select(text, text) from public, anon, authenticated;
revoke all on function public.stella_move_table(text, text) from public, anon, authenticated;

grant execute on function public.stella_request_company() to anon, authenticated, service_role;
grant execute on function public.stella_ensure_schema(text) to service_role;
grant execute on function public.stella_create_table(text, jsonb, text) to service_role;
grant execute on function public.stella_insert_rows(text, jsonb, text) to service_role;
grant execute on function public.stella_drop_table(text, text) to service_role;
grant execute on function public.stella_run_select(text, text) to service_role;
grant execute on function public.stella_move_table(text, text) to service_role;

-- ---------------------------------------------------------------------
-- Storage bucket for PDF / text source files (stella/ prefix).
-- If you prefer to reuse an existing bucket, the app falls back to the
-- `intelligence` bucket with a `stella/` prefix automatically.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('stella-data', 'stella-data', false)
on conflict (id) do nothing;

drop policy if exists "stella-data allow all" on storage.objects;
create policy "stella-data allow all" on storage.objects
  for all using (bucket_id = 'stella-data') with check (bucket_id = 'stella-data');
