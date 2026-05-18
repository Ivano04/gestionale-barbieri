export async function POST(request: Request) {
  const body = await request.json();
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) {
    return Response.json({ error: 'N8N_WEBHOOK_URL not configured' }, { status: 500 });
  }
  try {
    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, timestamp: new Date().toISOString() }),
    });
    if (!res.ok) {
      return Response.json({ error: `n8n webhook failed: ${res.status}` }, { status: 502 });
    }
    return Response.json({ status: 'ok' });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
