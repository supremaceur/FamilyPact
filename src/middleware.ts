import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware : CSP a nonce et redirections d'authentification legeres.
 *
 * La CSP est construite ici plutot que dans `next.config.ts` parce qu'un nonce
 * doit etre unique par reponse. Avec `strict-dynamic`, seuls les scripts portant
 * ce nonce — et ceux qu'ils chargent — s'executent : une injection de balise
 * `<script>` dans le HTML reste inerte.
 *
 * L'AUTORISATION N'EST PAS FAITE ICI. Le middleware s'execute avant l'acces a
 * la base et ne peut pas verifier une session de facon fiable ; il se contente
 * d'aiguiller. Chaque page et chaque route verifie ses propres droits par
 * `requireFamilyActor` / `requireCapability`.
 */
export const middleware = (request: NextRequest): NextResponse => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    // Tailwind et Next injectent des styles critiques en ligne.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  if (process.env.NODE_ENV === 'production') csp.push('upgrade-insecure-requests');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp.join('; '));
  return response;
};

export const config = {
  matcher: [
    // Les fichiers statiques immuables n'ont pas besoin d'une CSP par requete.
    '/((?!_next/static|_next/image|icons/|manifest.webmanifest|sw.js|favicon.ico).*)',
  ],
};
