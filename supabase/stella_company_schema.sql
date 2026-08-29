-- =====================================================================
-- Stella Insights — company schema isolation
-- Reference copy only. The app installs this automatically when a
-- company is created. Do not run this in the SQL editor.
-- =====================================================================

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

grant execute on function public.stella_ensure_schema(text) to service_role;
grant execute on function public.stella_create_table(text, jsonb, text) to service_role;
grant execute on function public.stella_insert_rows(text, jsonb, text) to service_role;
grant execute on function public.stella_drop_table(text, text) to service_role;
grant execute on function public.stella_run_select(text, text) to service_role;
grant execute on function public.stella_move_table(text, text) to service_role;
