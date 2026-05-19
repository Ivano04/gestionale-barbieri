import { getAvailableSlots } from '@/services/booking-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id');
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const slots = await getAvailableSlots({
    salon_id,
    service_id,
    stylist_id: stylist_id || undefined,
    date,
  });

  return Response.json(slots);
}
