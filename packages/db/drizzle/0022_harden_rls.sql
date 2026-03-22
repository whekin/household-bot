DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'housebot_app') THEN
    CREATE ROLE housebot_app LOGIN NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE housebot_app LOGIN NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'housebot_worker') THEN
    CREATE ROLE housebot_worker LOGIN NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE housebot_worker LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO housebot_app;
GRANT USAGE ON SCHEMA public TO housebot_worker;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO housebot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO housebot_worker;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO housebot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO housebot_worker;

DO $$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        target_role
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.app_current_telegram_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.telegram_user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION public.app_current_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.household_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_current_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.member_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(lower(nullif(current_setting('app.is_admin', true), '')) IN ('1', 'true', 't', 'yes', 'on'), false)
$$;

CREATE OR REPLACE FUNCTION public.app_is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user = 'housebot_worker'
    OR coalesce(lower(nullif(current_setting('app.is_worker', true), '')) IN ('1', 'true', 't', 'yes', 'on'), false)
$$;

GRANT EXECUTE ON FUNCTION public.app_current_telegram_user_id() TO housebot_app, housebot_worker;
GRANT EXECUTE ON FUNCTION public.app_current_household_id() TO housebot_app, housebot_worker;
GRANT EXECUTE ON FUNCTION public.app_current_member_id() TO housebot_app, housebot_worker;
GRANT EXECUTE ON FUNCTION public.app_is_admin() TO housebot_app, housebot_worker;
GRANT EXECUTE ON FUNCTION public.app_is_worker() TO housebot_app, housebot_worker;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'households',
    'household_billing_settings',
    'household_utility_categories',
    'household_telegram_chats',
    'household_topic_bindings',
    'household_join_tokens',
    'household_pending_members',
    'telegram_pending_actions',
    'members',
    'member_absence_policies',
    'billing_cycles',
    'rent_rules',
    'billing_cycle_exchange_rates',
    'utility_bills',
    'presence_overrides',
    'purchase_entries',
    'purchase_messages',
    'purchase_message_participants',
    'processed_bot_messages',
    'topic_messages',
    'anonymous_messages',
    'payment_confirmations',
    'payment_records',
    'settlements',
    'settlement_lines'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS households_select ON public.households;
CREATE POLICY households_select
ON public.households
FOR SELECT
USING (
  public.app_is_worker()
  OR public.app_current_telegram_user_id() IS NOT NULL
  OR id = public.app_current_household_id()
);

DROP POLICY IF EXISTS households_insert ON public.households;
CREATE POLICY households_insert
ON public.households
FOR INSERT
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS households_update ON public.households;
CREATE POLICY households_update
ON public.households
FOR UPDATE
USING (
  public.app_is_worker()
  OR (id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS households_delete ON public.households;
CREATE POLICY households_delete
ON public.households
FOR DELETE
USING (public.app_is_worker());

DROP POLICY IF EXISTS household_billing_settings_select ON public.household_billing_settings;
CREATE POLICY household_billing_settings_select
ON public.household_billing_settings
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_billing_settings_insert ON public.household_billing_settings;
CREATE POLICY household_billing_settings_insert
ON public.household_billing_settings
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_billing_settings_update ON public.household_billing_settings;
CREATE POLICY household_billing_settings_update
ON public.household_billing_settings
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_billing_settings_delete ON public.household_billing_settings;
CREATE POLICY household_billing_settings_delete
ON public.household_billing_settings
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_utility_categories_select ON public.household_utility_categories;
CREATE POLICY household_utility_categories_select
ON public.household_utility_categories
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_utility_categories_insert ON public.household_utility_categories;
CREATE POLICY household_utility_categories_insert
ON public.household_utility_categories
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_utility_categories_update ON public.household_utility_categories;
CREATE POLICY household_utility_categories_update
ON public.household_utility_categories
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_utility_categories_delete ON public.household_utility_categories;
CREATE POLICY household_utility_categories_delete
ON public.household_utility_categories
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_telegram_chats_select ON public.household_telegram_chats;
CREATE POLICY household_telegram_chats_select
ON public.household_telegram_chats
FOR SELECT
USING (
  public.app_is_worker()
  OR public.app_current_telegram_user_id() IS NOT NULL
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_telegram_chats_insert ON public.household_telegram_chats;
CREATE POLICY household_telegram_chats_insert
ON public.household_telegram_chats
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_telegram_chats_update ON public.household_telegram_chats;
CREATE POLICY household_telegram_chats_update
ON public.household_telegram_chats
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_telegram_chats_delete ON public.household_telegram_chats;
CREATE POLICY household_telegram_chats_delete
ON public.household_telegram_chats
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_topic_bindings_select ON public.household_topic_bindings;
CREATE POLICY household_topic_bindings_select
ON public.household_topic_bindings
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_topic_bindings_insert ON public.household_topic_bindings;
CREATE POLICY household_topic_bindings_insert
ON public.household_topic_bindings
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_topic_bindings_update ON public.household_topic_bindings;
CREATE POLICY household_topic_bindings_update
ON public.household_topic_bindings
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_topic_bindings_delete ON public.household_topic_bindings;
CREATE POLICY household_topic_bindings_delete
ON public.household_topic_bindings
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_join_tokens_select ON public.household_join_tokens;
CREATE POLICY household_join_tokens_select
ON public.household_join_tokens
FOR SELECT
USING (
  public.app_is_worker()
  OR public.app_current_telegram_user_id() IS NOT NULL
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_join_tokens_insert ON public.household_join_tokens;
CREATE POLICY household_join_tokens_insert
ON public.household_join_tokens
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_join_tokens_update ON public.household_join_tokens;
CREATE POLICY household_join_tokens_update
ON public.household_join_tokens
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_join_tokens_delete ON public.household_join_tokens;
CREATE POLICY household_join_tokens_delete
ON public.household_join_tokens
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_pending_members_select ON public.household_pending_members;
CREATE POLICY household_pending_members_select
ON public.household_pending_members
FOR SELECT
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS household_pending_members_insert ON public.household_pending_members;
CREATE POLICY household_pending_members_insert
ON public.household_pending_members
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_pending_members_update ON public.household_pending_members;
CREATE POLICY household_pending_members_update
ON public.household_pending_members
FOR UPDATE
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS household_pending_members_delete ON public.household_pending_members;
CREATE POLICY household_pending_members_delete
ON public.household_pending_members
FOR DELETE
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS telegram_pending_actions_select ON public.telegram_pending_actions;
CREATE POLICY telegram_pending_actions_select
ON public.telegram_pending_actions
FOR SELECT
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
);

DROP POLICY IF EXISTS telegram_pending_actions_insert ON public.telegram_pending_actions;
CREATE POLICY telegram_pending_actions_insert
ON public.telegram_pending_actions
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
);

DROP POLICY IF EXISTS telegram_pending_actions_update ON public.telegram_pending_actions;
CREATE POLICY telegram_pending_actions_update
ON public.telegram_pending_actions
FOR UPDATE
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
)
WITH CHECK (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
);

DROP POLICY IF EXISTS telegram_pending_actions_delete ON public.telegram_pending_actions;
CREATE POLICY telegram_pending_actions_delete
ON public.telegram_pending_actions
FOR DELETE
USING (
  public.app_is_worker()
  OR telegram_user_id = public.app_current_telegram_user_id()
);

DROP POLICY IF EXISTS members_select ON public.members;
CREATE POLICY members_select
ON public.members
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
  OR telegram_user_id = public.app_current_telegram_user_id()
);

DROP POLICY IF EXISTS members_insert ON public.members;
CREATE POLICY members_insert
ON public.members
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS members_update ON public.members;
CREATE POLICY members_update
ON public.members
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
  OR (
    household_id = public.app_current_household_id()
    AND telegram_user_id = public.app_current_telegram_user_id()
  )
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
  OR (
    household_id = public.app_current_household_id()
    AND telegram_user_id = public.app_current_telegram_user_id()
  )
);

DROP POLICY IF EXISTS members_delete ON public.members;
CREATE POLICY members_delete
ON public.members
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS member_absence_policies_select ON public.member_absence_policies;
CREATE POLICY member_absence_policies_select
ON public.member_absence_policies
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS member_absence_policies_insert ON public.member_absence_policies;
CREATE POLICY member_absence_policies_insert
ON public.member_absence_policies
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS member_absence_policies_update ON public.member_absence_policies;
CREATE POLICY member_absence_policies_update
ON public.member_absence_policies
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS member_absence_policies_delete ON public.member_absence_policies;
CREATE POLICY member_absence_policies_delete
ON public.member_absence_policies
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS billing_cycles_select ON public.billing_cycles;
CREATE POLICY billing_cycles_select
ON public.billing_cycles
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS billing_cycles_insert ON public.billing_cycles;
CREATE POLICY billing_cycles_insert
ON public.billing_cycles
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS billing_cycles_update ON public.billing_cycles;
CREATE POLICY billing_cycles_update
ON public.billing_cycles
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS billing_cycles_delete ON public.billing_cycles;
CREATE POLICY billing_cycles_delete
ON public.billing_cycles
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS rent_rules_select ON public.rent_rules;
CREATE POLICY rent_rules_select
ON public.rent_rules
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS rent_rules_insert ON public.rent_rules;
CREATE POLICY rent_rules_insert
ON public.rent_rules
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS rent_rules_update ON public.rent_rules;
CREATE POLICY rent_rules_update
ON public.rent_rules
FOR UPDATE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
)
WITH CHECK (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS rent_rules_delete ON public.rent_rules;
CREATE POLICY rent_rules_delete
ON public.rent_rules
FOR DELETE
USING (
  public.app_is_worker()
  OR (household_id = public.app_current_household_id() AND public.app_is_admin())
);

DROP POLICY IF EXISTS billing_cycle_exchange_rates_select ON public.billing_cycle_exchange_rates;
CREATE POLICY billing_cycle_exchange_rates_select
ON public.billing_cycle_exchange_rates
FOR SELECT
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.billing_cycles cycle
    WHERE cycle.id = billing_cycle_exchange_rates.cycle_id
      AND cycle.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS billing_cycle_exchange_rates_insert ON public.billing_cycle_exchange_rates;
CREATE POLICY billing_cycle_exchange_rates_insert
ON public.billing_cycle_exchange_rates
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.billing_cycles cycle
      WHERE cycle.id = billing_cycle_exchange_rates.cycle_id
        AND cycle.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS billing_cycle_exchange_rates_update ON public.billing_cycle_exchange_rates;
CREATE POLICY billing_cycle_exchange_rates_update
ON public.billing_cycle_exchange_rates
FOR UPDATE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.billing_cycles cycle
    WHERE cycle.id = billing_cycle_exchange_rates.cycle_id
      AND cycle.household_id = public.app_current_household_id()
  )
)
WITH CHECK (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.billing_cycles cycle
      WHERE cycle.id = billing_cycle_exchange_rates.cycle_id
        AND cycle.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS billing_cycle_exchange_rates_delete ON public.billing_cycle_exchange_rates;
CREATE POLICY billing_cycle_exchange_rates_delete
ON public.billing_cycle_exchange_rates
FOR DELETE
USING (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.billing_cycles cycle
      WHERE cycle.id = billing_cycle_exchange_rates.cycle_id
        AND cycle.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS utility_bills_select ON public.utility_bills;
CREATE POLICY utility_bills_select
ON public.utility_bills
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS utility_bills_insert ON public.utility_bills;
CREATE POLICY utility_bills_insert
ON public.utility_bills
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS utility_bills_update ON public.utility_bills;
CREATE POLICY utility_bills_update
ON public.utility_bills
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS utility_bills_delete ON public.utility_bills;
CREATE POLICY utility_bills_delete
ON public.utility_bills
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS presence_overrides_select ON public.presence_overrides;
CREATE POLICY presence_overrides_select
ON public.presence_overrides
FOR SELECT
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.members member
    WHERE member.id = presence_overrides.member_id
      AND member.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS presence_overrides_insert ON public.presence_overrides;
CREATE POLICY presence_overrides_insert
ON public.presence_overrides
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.members member
      WHERE member.id = presence_overrides.member_id
        AND member.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS presence_overrides_update ON public.presence_overrides;
CREATE POLICY presence_overrides_update
ON public.presence_overrides
FOR UPDATE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.members member
    WHERE member.id = presence_overrides.member_id
      AND member.household_id = public.app_current_household_id()
  )
)
WITH CHECK (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.members member
      WHERE member.id = presence_overrides.member_id
        AND member.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS presence_overrides_delete ON public.presence_overrides;
CREATE POLICY presence_overrides_delete
ON public.presence_overrides
FOR DELETE
USING (
  public.app_is_worker()
  OR (
    public.app_is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.members member
      WHERE member.id = presence_overrides.member_id
        AND member.household_id = public.app_current_household_id()
    )
  )
);

DROP POLICY IF EXISTS purchase_entries_select ON public.purchase_entries;
CREATE POLICY purchase_entries_select
ON public.purchase_entries
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_entries_insert ON public.purchase_entries;
CREATE POLICY purchase_entries_insert
ON public.purchase_entries
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_entries_update ON public.purchase_entries;
CREATE POLICY purchase_entries_update
ON public.purchase_entries
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_entries_delete ON public.purchase_entries;
CREATE POLICY purchase_entries_delete
ON public.purchase_entries
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_messages_select ON public.purchase_messages;
CREATE POLICY purchase_messages_select
ON public.purchase_messages
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_messages_insert ON public.purchase_messages;
CREATE POLICY purchase_messages_insert
ON public.purchase_messages
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_messages_update ON public.purchase_messages;
CREATE POLICY purchase_messages_update
ON public.purchase_messages
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_messages_delete ON public.purchase_messages;
CREATE POLICY purchase_messages_delete
ON public.purchase_messages
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS purchase_message_participants_select ON public.purchase_message_participants;
CREATE POLICY purchase_message_participants_select
ON public.purchase_message_participants
FOR SELECT
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.purchase_messages purchase
    WHERE purchase.id = purchase_message_participants.purchase_message_id
      AND purchase.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS purchase_message_participants_insert ON public.purchase_message_participants;
CREATE POLICY purchase_message_participants_insert
ON public.purchase_message_participants
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.purchase_messages purchase
    WHERE purchase.id = purchase_message_participants.purchase_message_id
      AND purchase.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS purchase_message_participants_update ON public.purchase_message_participants;
CREATE POLICY purchase_message_participants_update
ON public.purchase_message_participants
FOR UPDATE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.purchase_messages purchase
    WHERE purchase.id = purchase_message_participants.purchase_message_id
      AND purchase.household_id = public.app_current_household_id()
  )
)
WITH CHECK (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.purchase_messages purchase
    WHERE purchase.id = purchase_message_participants.purchase_message_id
      AND purchase.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS purchase_message_participants_delete ON public.purchase_message_participants;
CREATE POLICY purchase_message_participants_delete
ON public.purchase_message_participants
FOR DELETE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.purchase_messages purchase
    WHERE purchase.id = purchase_message_participants.purchase_message_id
      AND purchase.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS processed_bot_messages_select ON public.processed_bot_messages;
CREATE POLICY processed_bot_messages_select
ON public.processed_bot_messages
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS processed_bot_messages_insert ON public.processed_bot_messages;
CREATE POLICY processed_bot_messages_insert
ON public.processed_bot_messages
FOR INSERT
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS processed_bot_messages_update ON public.processed_bot_messages;
CREATE POLICY processed_bot_messages_update
ON public.processed_bot_messages
FOR UPDATE
USING (public.app_is_worker())
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS processed_bot_messages_delete ON public.processed_bot_messages;
CREATE POLICY processed_bot_messages_delete
ON public.processed_bot_messages
FOR DELETE
USING (public.app_is_worker());

DROP POLICY IF EXISTS topic_messages_select ON public.topic_messages;
CREATE POLICY topic_messages_select
ON public.topic_messages
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS topic_messages_insert ON public.topic_messages;
CREATE POLICY topic_messages_insert
ON public.topic_messages
FOR INSERT
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS topic_messages_update ON public.topic_messages;
CREATE POLICY topic_messages_update
ON public.topic_messages
FOR UPDATE
USING (public.app_is_worker())
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS topic_messages_delete ON public.topic_messages;
CREATE POLICY topic_messages_delete
ON public.topic_messages
FOR DELETE
USING (public.app_is_worker());

DROP POLICY IF EXISTS anonymous_messages_select ON public.anonymous_messages;
CREATE POLICY anonymous_messages_select
ON public.anonymous_messages
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS anonymous_messages_insert ON public.anonymous_messages;
CREATE POLICY anonymous_messages_insert
ON public.anonymous_messages
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS anonymous_messages_update ON public.anonymous_messages;
CREATE POLICY anonymous_messages_update
ON public.anonymous_messages
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS anonymous_messages_delete ON public.anonymous_messages;
CREATE POLICY anonymous_messages_delete
ON public.anonymous_messages
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS payment_confirmations_select ON public.payment_confirmations;
CREATE POLICY payment_confirmations_select
ON public.payment_confirmations
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS payment_confirmations_insert ON public.payment_confirmations;
CREATE POLICY payment_confirmations_insert
ON public.payment_confirmations
FOR INSERT
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS payment_confirmations_update ON public.payment_confirmations;
CREATE POLICY payment_confirmations_update
ON public.payment_confirmations
FOR UPDATE
USING (public.app_is_worker())
WITH CHECK (public.app_is_worker());

DROP POLICY IF EXISTS payment_confirmations_delete ON public.payment_confirmations;
CREATE POLICY payment_confirmations_delete
ON public.payment_confirmations
FOR DELETE
USING (public.app_is_worker());

DROP POLICY IF EXISTS payment_records_select ON public.payment_records;
CREATE POLICY payment_records_select
ON public.payment_records
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS payment_records_insert ON public.payment_records;
CREATE POLICY payment_records_insert
ON public.payment_records
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS payment_records_update ON public.payment_records;
CREATE POLICY payment_records_update
ON public.payment_records
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS payment_records_delete ON public.payment_records;
CREATE POLICY payment_records_delete
ON public.payment_records
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS settlements_select ON public.settlements;
CREATE POLICY settlements_select
ON public.settlements
FOR SELECT
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS settlements_insert ON public.settlements;
CREATE POLICY settlements_insert
ON public.settlements
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS settlements_update ON public.settlements;
CREATE POLICY settlements_update
ON public.settlements
FOR UPDATE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
)
WITH CHECK (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS settlements_delete ON public.settlements;
CREATE POLICY settlements_delete
ON public.settlements
FOR DELETE
USING (
  public.app_is_worker()
  OR household_id = public.app_current_household_id()
);

DROP POLICY IF EXISTS settlement_lines_select ON public.settlement_lines;
CREATE POLICY settlement_lines_select
ON public.settlement_lines
FOR SELECT
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.settlements settlement
    WHERE settlement.id = settlement_lines.settlement_id
      AND settlement.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS settlement_lines_insert ON public.settlement_lines;
CREATE POLICY settlement_lines_insert
ON public.settlement_lines
FOR INSERT
WITH CHECK (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.settlements settlement
    WHERE settlement.id = settlement_lines.settlement_id
      AND settlement.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS settlement_lines_update ON public.settlement_lines;
CREATE POLICY settlement_lines_update
ON public.settlement_lines
FOR UPDATE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.settlements settlement
    WHERE settlement.id = settlement_lines.settlement_id
      AND settlement.household_id = public.app_current_household_id()
  )
)
WITH CHECK (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.settlements settlement
    WHERE settlement.id = settlement_lines.settlement_id
      AND settlement.household_id = public.app_current_household_id()
  )
);

DROP POLICY IF EXISTS settlement_lines_delete ON public.settlement_lines;
CREATE POLICY settlement_lines_delete
ON public.settlement_lines
FOR DELETE
USING (
  public.app_is_worker()
  OR EXISTS (
    SELECT 1
    FROM public.settlements settlement
    WHERE settlement.id = settlement_lines.settlement_id
      AND settlement.household_id = public.app_current_household_id()
  )
);
