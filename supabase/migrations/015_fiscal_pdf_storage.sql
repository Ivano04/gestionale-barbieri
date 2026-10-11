BEGIN;
ALTER TABLE public.fiscal_documents
  ADD COLUMN pdf_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN pdf_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN pdf_last_error text;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('fiscal-documents','fiscal-documents',false,15000000,ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=15000000,allowed_mime_types=ARRAY['application/pdf'];
-- Only the server can access this bucket, even if another bucket has a broad policy.
CREATE POLICY fiscal_storage_server_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated USING (bucket_id <> 'fiscal-documents')
WITH CHECK (bucket_id <> 'fiscal-documents');
COMMIT;
