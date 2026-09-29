import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export default async function proxy(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  const isPublic = request.nextUrl.pathname.startsWith('/book/') ||
                   request.nextUrl.pathname.startsWith('/pagamento/') ||
                   request.nextUrl.pathname.startsWith('/prenotazione/') ||
                   request.nextUrl.pathname.startsWith('/login') ||
                   request.nextUrl.pathname.startsWith('/auth') ||
                   request.nextUrl.pathname.startsWith('/api/book/') ||
                   request.nextUrl.pathname.startsWith('/api/slots') ||
                   request.nextUrl.pathname.startsWith('/api/services') ||
                   request.nextUrl.pathname.startsWith('/api/payments/create') ||
                   request.nextUrl.pathname.startsWith('/api/appointments/cancel') ||
                   request.nextUrl.pathname.startsWith('/api/webhooks/') ||
                   request.nextUrl.pathname.startsWith('/_next') ||
                   request.nextUrl.pathname === '/favicon.ico';

  // Bypass auth per le chiamate server-to-server interne (es. il webhook che crea
  // l'appuntamento via /api/appointments), autenticate con un segreto condiviso.
  const internalSecret = request.headers.get('x-internal-secret');
  const isInternal = !!process.env.CRON_SECRET && internalSecret === process.env.CRON_SECRET;
  if (isInternal) return supabaseResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const proxyConfig = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
