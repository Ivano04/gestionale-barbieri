import { createAdminClient } from '@/lib/supabase/admin';
import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { FISCAL_BUCKET, fiscalPdfPath } from '@/services/fiscal/pdf-storage';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await fiscalStaffAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: 'Documento non trovato' }, { status: 404 });
  }
  // Read through user RLS and explicit salon scope before touching service-role storage.
  const { data: document, error } = await access.db.from('fiscal_documents')
    .select('id,salon_id,mode,pdf_storage_path,processing_status').eq('id', id).eq('salon_id', access.salonId).maybeSingle();
  if (error) return Response.json({ error: 'Documento non disponibile' }, { status: 500 });
  if (!document) return Response.json({ error: 'Documento non trovato' }, { status: 404 });
  const path = fiscalPdfPath(document.salon_id, document.id, document.mode);
  if (document.processing_status !== 'completed' || document.pdf_storage_path !== path) {
    return Response.json({ error: 'PDF non ancora disponibile' }, { status: 409 });
  }
  const { data, error: downloadError } = await createAdminClient().storage.from(FISCAL_BUCKET).download(path);
  if (downloadError || !data) return Response.json({ error: 'Download temporaneamente non disponibile' }, { status: 503 });
  return new Response(await data.arrayBuffer(), { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="ricevuta-${document.mode}-${id}.pdf"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
