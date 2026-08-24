import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FamiliPact — Les regles familiales, simplement.',
    template: '%s · FamiliPact',
  },
  description:
    'FamiliPact aide les familles a definir un cadre clair : taches, points, recompenses et sanctions, avec une decision parentale explicite a chaque etape.',
  applicationName: 'FamiliPact',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'FamiliPact',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  // L'application est privee : elle ne doit jamais etre indexee.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `maximumScale` n'est pas verrouille : brider le zoom nuit a l'accessibilite.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1b19' },
  ],
};

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="fr">
    <body className="min-h-dvh antialiased">
      <a href="#contenu" className="skip-link">
        Aller au contenu principal
      </a>
      {children}
      <ServiceWorkerRegistrar />
    </body>
  </html>
);

export default RootLayout;
