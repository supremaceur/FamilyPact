import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/layout/app-shell';
import { HomeIcon, PointsIcon, ProfileIcon, RewardIcon, TaskIcon } from '@/components/layout/icons';
import { isDomainError } from '@/domain/errors';
import { requireChildActor } from '@/server/auth/context';
import { countUnreadNotifications } from '@/server/queries/history';

/**
 * Coquille de l'espace enfant.
 *
 * Navigation volontairement courte : cinq entrees, aucune section de gestion.
 * Un enfant ne dispose d'AUCUNE commande capable de modifier un score, une
 * regle, une sanction ou une tache — ni ici, ni cote serveur.
 */
const ChildLayout = async ({ children }: { readonly children: ReactNode }) => {
  let actor;
  try {
    actor = await requireChildActor();
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'UNAUTHENTICATED') redirect('/connexion');
      if (error.code === 'FORBIDDEN') redirect('/parent');
      if (error.code === 'MFA_ENROLLMENT_REQUIRED') redirect('/securite/configuration');
      if (error.code === 'MFA_REQUIRED') redirect('/securite/verification');
    }
    throw error;
  }

  const unread = await countUnreadNotifications(actor);

  const primaryNav: NavItem[] = [
    { href: '/enfant', label: 'Accueil', icon: <HomeIcon /> },
    { href: '/enfant/taches', label: 'Mes taches', icon: <TaskIcon /> },
    { href: '/enfant/points', label: 'Mes points', icon: <PointsIcon /> },
    { href: '/enfant/recompenses', label: 'Recompenses', icon: <RewardIcon /> },
    { href: '/enfant/profil', label: 'Profil', icon: <ProfileIcon /> },
  ];

  return (
    <AppShell
      space="child"
      headline={`Bonjour ${actor.displayName}`}
      primaryNav={primaryNav}
      unreadNotifications={unread}
    >
      {children}
    </AppShell>
  );
};

export default ChildLayout;
