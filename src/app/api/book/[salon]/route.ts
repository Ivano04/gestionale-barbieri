import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request, { params }: { params: Promise<{ salon: string }> }) {
  const { salon: slug } = await params;
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons').select('id, name, address, phone, timezone').eq('slug', slug).single();
  if (!salon) return Response.json({ error: 'Salon not found' }, { status: 404 });

  const { data: services } = await supabase
    .from('services').select('id, name, duration_minutes, price_cents, color_hex')
    .eq('salon_id', salon.id).eq('is_active', true).order('name');

  return Response.json({ salon, services: services || [] });
}
