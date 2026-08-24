/*
  # F5 — Payment proofs are no longer world-readable

  The `payment-proofs` bucket was public with no size or MIME limit, and the policy
  `payment_proofs_public_read` granted SELECT on every object in it to the `anon`
  role with no owner predicate. That authorises both listing and downloading, so
  every uploaded bank-transfer screenshot was readable by anyone holding the public
  anon key.

  The bucket becomes private with a 5 MB limit and an image MIME allowlist, and the
  blanket read and insert policies are removed. Uploads and viewing now go through
  the session-validated `payment-proof` edge function, which checks that the caller
  owns the proof (or is an admin) and issues a short-lived signed URL.
*/

UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'payment-proofs';

DROP POLICY IF EXISTS "payment_proofs_public_read" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_authenticated_insert" ON storage.objects;
