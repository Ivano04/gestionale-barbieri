import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
export async function GET(request: Request) {
  const access = await fiscalStaffAccess();
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const page = Math.max(0, Math.min(10000, Number.parseInt(params.get('page') ?? '0', 10) || 0));
  const { data, error, count } = await access.db.from('fiscal_documents')
    .select('id,appointment_id,status,original_document_id,operation_snapshot,amount_cents,created_at,issued_at,mode,operation,processing_status,pdf_storage_path,pdf_last_error,last_error_code,payment:payments(status,refund_jobs(state,reason)),email_jobs:fiscal_email_jobs(state,sent_at)', { count: 'exact' })
    .eq('salon_id', access.salonId).order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24);
  if (error) return Response.json({ error: 'Impossibile caricare i documenti' }, { status: 500 });
  return Response.json({ documents: (data ?? []).map(({ pdf_storage_path, operation_snapshot, email_jobs, ...document }) => ({ ...document, email_status: email_jobs?.[0]?.state ?? (process.env.FISKALY_TEST_EMAIL_ENABLED === 'true' ? 'waiting_pdf' : 'disabled'), number: typeof operation_snapshot?.document?.number === 'string' ? operation_snapshot.document.number : null, pdf_available: !!pdf_storage_path })), total: count ?? 0 },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
