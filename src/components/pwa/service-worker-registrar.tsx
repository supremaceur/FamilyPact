'use client';

import { useEffect } from 'react';

/**
 * Enregistrement du service worker.
 *
 * L'enregistrement est differe apres le chargement : il ne doit pas concurrencer
 * le rendu initial. En developpement, aucun service worker n'est enregistre —
 * un cache persistant rendrait le rechargement a chaud imprevisible — et tout
 * enregistrement herite d'une session precedente est retire.
 */
export const ServiceWorkerRegistrar = () => {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      return;
    }

    const register = (): void => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => {
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
};
