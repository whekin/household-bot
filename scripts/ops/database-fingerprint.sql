-- One compact fingerprint for the application's public tables. Run on each side
-- after writes stop; the final field changes if any row value changes.
-- __drizzle_migrations is excluded because a migrations-first restore can have
-- a different history table while application data is identical.
with table_fingerprints as (
  select
    table_name,
    (
      xpath(
        '/row/count/text()',
        query_to_xml(
          format('select count(*) as count from public.%I', table_name),
          false,
          true,
          ''
        )
      )
    )[1]::text as row_count,
    coalesce(
      (
        xpath(
          '/row/digest/text()',
          query_to_xml(
            format(
              'select md5(string_agg(d, %L order by d)) digest from (select md5(row_to_json(t)::text) d from public.%I t) x',
              '',
              table_name
            ),
            false,
            true,
            ''
          )
        )
      )[1]::text,
      ''
    ) as digest
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and table_name <> '__drizzle_migrations'
)
select
  count(*) as table_count,
  sum(row_count::bigint) as row_count,
  md5(string_agg(table_name || ':' || row_count || ':' || digest, '|' order by table_name))
    as content_fingerprint
from table_fingerprints;
