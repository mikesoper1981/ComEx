-- =====================================================================
-- Stella Insights — Supabase setup
-- Run this once in the Supabase SQL editor for your project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Registry of every file Stella knows about (tabular datasets + docs).
-- org_id is 'user:<userId>' so each account has its own files. Legacy rows
-- used org_id = 'default' and are claimed by the first admin on load.
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

alter table public.stella_files enable row level security;

drop policy if exists "stella_files allow all" on public.stella_files;
create policy "stella_files allow all" on public.stella_files
  for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- Read-only SELECT executor.
-- Called from api/stella-query.cjs using the service-role key.
-- Rejects anything that is not a single SELECT statement.
-- ---------------------------------------------------------------------
create or replace function public.stella_run_select(query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result  jsonb;
  cleaned text := btrim(query);
begin
  if left(lower(cleaned), 6) <> 'select' then
    raise exception 'Only SELECT statements are allowed';
  end if;
  -- Disallow stacked statements (a semicolon that is not a trailing one).
  if position(';' in rtrim(cleaned, ';')) > 0 then
    raise exception 'Multiple statements are not allowed';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', rtrim(cleaned, ';'))
    into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- Create a dynamic Stella data table (stella_data_<nanoid>).
-- p_columns: [{ "name": "safe_col", "type": "numeric" | "text" }, ...]
-- ---------------------------------------------------------------------
create or replace function public.stella_create_table(p_table_name text, p_columns jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  col      jsonb;
  col_defs text := '';
  col_type text;
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  for col in select * from jsonb_array_elements(p_columns) loop
    col_type := case when lower(col->>'type') = 'numeric' then 'numeric' else 'text' end;
    col_defs := col_defs || format('%I %s, ', col->>'name', col_type);
  end loop;
  if col_defs = '' then
    raise exception 'No columns provided';
  end if;
  execute format('create table if not exists public.%I (%s)', p_table_name, rtrim(col_defs, ', '));
end;
$$;

-- ---------------------------------------------------------------------
-- Insert a batch of rows into a dynamic Stella data table.
-- p_rows: a JSON array of objects keyed by the safe column names.
-- ---------------------------------------------------------------------
create or replace function public.stella_insert_rows(p_table_name text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  execute format(
    'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
    p_table_name, p_table_name
  ) using p_rows;
end;
$$;

-- ---------------------------------------------------------------------
-- Drop a dynamic Stella data table (used when a file is deleted).
-- ---------------------------------------------------------------------
create or replace function public.stella_drop_table(p_table_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_table_name !~ '^stella_data_[a-z0-9_]+$' then
    raise exception 'Invalid table name: %', p_table_name;
  end if;
  execute format('drop table if exists public.%I', p_table_name);
end;
$$;

grant execute on function public.stella_run_select(text)          to anon, authenticated, service_role;
grant execute on function public.stella_create_table(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.stella_insert_rows(text, jsonb)  to anon, authenticated, service_role;
grant execute on function public.stella_drop_table(text)          to anon, authenticated, service_role;

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
