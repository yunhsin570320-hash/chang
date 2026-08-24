-- F13: phone uniqueness was only checked in application code, and the check used
-- raw equality while the password reset lookup used the digits-only form, so two
-- accounts could hold the same number written differently and a reset could land
-- on the wrong one. Enforce a single canonical form in the database.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_normalized_key
  ON public.profiles ((regexp_replace(phone, '[^0-9]', '', 'g')))
  WHERE phone IS NOT NULL AND btrim(phone) <> '';