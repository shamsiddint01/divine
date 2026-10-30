-- Divine.uz — DB yaxlitlik manifesti (Phase 17, RUNBOOK §4). Backup oldidan va restore'dan keyin
-- olinadi; ikkalasi bir xil bo'lishi kerak (yozuvlar to'xtatilgan holda). Faqat O'QIYDI, hech narsa
-- o'zgartirmaydi. Chiqish: `kalit<TAB>qiymat` qatorlari (diff qilish uchun barqaror tartib).
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

-- 1) Har bir jadvaldagi qatorlar soni.
SELECT 'count.' || relname, (xpath('/row/c/text()',
         query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname), false, true, '')))[1]::text
  FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname;

-- 2) O'zgarmas va moliyaviy jadvallarning mazmun nazorat yig'indisi (tartiblangan qatorlar md5'i).
SELECT 'md5.audit_logs', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM audit_logs t;
SELECT 'md5.inventory_movements', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM inventory_movements t;
SELECT 'md5.sales', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM sales t;
SELECT 'md5.sale_items', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM sale_items t;
SELECT 'md5.warehouse_stock', md5(coalesce(string_agg(t::text, E'\n' ORDER BY warehouse_id, product_id), '')) FROM warehouse_stock t;
SELECT 'md5.incoming', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM incoming t;
SELECT 'md5.incoming_items', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM incoming_items t;
SELECT 'md5.users', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM users t;
SELECT 'md5.customers', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM customers t;
SELECT 'md5.expenses', md5(coalesce(string_agg(t::text, E'\n' ORDER BY id), '')) FROM expenses t;

-- 3) Invariantlar: reconciliation view'larida nomuvofiqlik yo'q (DATABASE §5.4).
SELECT 'invariant.reconcile_inventory_stock', count(*) FROM reconcile_inventory_stock;
SELECT 'invariant.reconcile_document_movements', count(*) FROM reconcile_document_movements;
SELECT 'invariant.reconcile_document_totals', count(*) FROM reconcile_document_totals;
SELECT 'invariant.reconcile_customer_aggregates', count(*) FROM reconcile_customer_aggregates;
SELECT 'invariant.reconcile_sales_totals', count(*) FROM reconcile_sales_totals;
SELECT 'invariant.negative_stock', count(*) FROM warehouse_stock WHERE quantity < 0;

-- 4) Himoya qatlamlari tiklangan: immutability trigger'lari va divine_app huquqlari.
SELECT 'guard.immutable_triggers', count(*) FROM pg_trigger
 WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname IN ('audit_logs_immutable', 'inventory_movements_immutable',
       'sales_immutable', 'sale_items_immutable', 'audit_logs_no_truncate',
       'inventory_movements_no_truncate', 'sales_no_truncate', 'sale_items_no_truncate');
SELECT 'guard.app_can_update_ledger_or_audit',
       bool_or(has_table_privilege('divine_app', t, 'UPDATE') OR has_table_privilege('divine_app', t, 'DELETE'))
  FROM unnest(ARRAY['audit_logs', 'inventory_movements', 'sales', 'sale_items']) t;
SELECT 'guard.app_can_insert_audit', has_table_privilege('divine_app', 'audit_logs', 'INSERT');
SELECT 'guard.db_owner', pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();
SELECT 'guard.timezone', coalesce((SELECT split_part(c, '=', 2) FROM pg_db_role_setting s, unnest(s.setconfig) c
         WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND s.setrole = 0 AND c LIKE 'TimeZone=%'), 'yo‘q');
SELECT 'schema.migrations', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
