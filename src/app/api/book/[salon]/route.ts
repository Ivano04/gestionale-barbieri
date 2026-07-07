import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request, { params }: { params: Promise<{ salon: string }> }) {
  const { salon: slug } = await params;
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons').select('id, name, address, phone, timezone').eq('slug', slug).single();
  if (!salon) return Response.json({ error: 'Salon not found' }, { status: 404 });

  const [svcRes, catRes] = await Promise.all([
    supabase.from('services').select('id, name, duration_minutes, price_cents, color_hex, category_id, duration_application, duration_processing, duration_finishing, buffer_time_minutes')
      .eq('salon_id', salon.id).eq('is_active', true).order('name'),
    supabase.from('service_categories').select('id, name, color_hex').eq('salon_id', salon.id).order('sort_order'),
  ]);

  return Response.json({ salon, services: svcRes.data || [], categories: catRes.data || [] });
}
