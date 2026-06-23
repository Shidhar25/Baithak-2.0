import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function getSessionHash(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "baitha_salt_2026");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request: NextRequest) {
  const adminSession = request.cookies.get('admin_session')?.value;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const expectedSession = await getSessionHash(adminPassword);

  const isAuthenticated = adminSession === expectedSession;
  const url = request.nextUrl.clone();
  
  if (!isAuthenticated) {
    // If it's an API request, return 401 Unauthorized
    if (url.pathname.startsWith('/api')) {
      return new NextResponse(
        JSON.stringify({ error: 'सांकेतिक शब्द (पासवर्ड) देणे आवश्यक आहे.' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
    
    // Otherwise, redirect to login page
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth APIs)
     * - login (login page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - NotoSansDevanagari-Regular.ttf (font file)
     */
    '/((?!api/auth|login|_next/static|_next/image|favicon.ico|NotoSansDevanagari-Regular.ttf).*)',
  ],
};
