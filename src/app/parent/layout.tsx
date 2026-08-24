import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/layout/app-shell';
import {
  ChildrenIcon,
  CheckIcon,
  HistoryIcon,
  HomeIcon,
  MembersIcon,
  PointsIcon,
  RewardIcon,
  RulesIcon,
  SanctionIcon,
  SettingsIcon,
  ShieldIcon,
  TaskIcon,
} from '@/components/layout/icons';
import { isDomainError } from '@/domain/errors';
import { requireParentActor } from '@/server/auth/context';
import { countUnreadNotifications } from '@/server/queries/history';
import { getParentDashboard } from '@/server/queries/parent-dashboard';

/**
 * Coquille de l'espace parent.
 *
 * L'autorisation est verifiee ICI, cote serveur, avant tout rendu : un compte
 * enfant ou une session incomplete n'atteint jamais ces pages. Le middleware ne
 * fait qu'aiguiller, il n'autorise rien.
 */
const ParentLayout = async ({ children }: { readonly children: ReactNode }) => {
  let actor;
  try {
    actor = await requireParentActor();
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'MFA_ENROLLMENT_REQUIRED') redirect('/securite/configuration');
      if (error.code === 'MFA_REQUIRED') redirect('/securite/verification');
      if (error.code === 'UNAUTHENTICATED') redirect('/connexion');
      if (error.code === 'FORBIDDEN') redirect('/enfant');
    }
    throw error;
  }

  const [dashboard, unread] = await Promise.all([
    getParentDashboard(actor),
    countUnreadNotifications(actor),
  ]);

  const primaryNav: NavItem[] = [
    { href: '/parent', label: 'Accueil', icon: <HomeIcon /> },
    {
      href: '/parent/validations',
      label: 'Validations',
      icon: <CheckIcon />,
      badge: dashboard.actionsRequired.total,
    },
    { href: '/parent/taches', label: 'Taches', icon: <TaskIcon /> },
    { href: '/parent/enfants', label: 'Enfants', icon: <ChildrenIcon /> },
    { href: '/parent/historique', label: 'Historique', icon: <HistoryIcon /> },
  ];

  const secondaryNav: NavItem[] = [
    { href: '/parent/recompenses', label: 'Recompenses', icon: <RewardIcon /> },
    { href: '/parent/sanctions', label: 'Sanctions', icon: <SanctionIcon /> },
    { href: '/parent/regles', label: 'Regles', icon: <RulesIcon /> },
    { href: '/parent/points', label: 'Points', icon: <PointsIcon /> },
    { href: '/parent/membres', label: 'Membres', icon: <MembersIcon /> },
    { href: '/parent/securite', label: 'Securite', icon: <ShieldIcon /> },
    { href: '/parent/parametres', label: 'Parametres', icon: <SettingsIcon /> },
    { href: '/parent/audit', label: 'Audit', icon: <HistoryIcon /> },
  ];

  return (
    <AppShell
      space="parent"
      headline={actor.familyName}
      primaryNav={primaryNav}
      secondaryNav={secondaryNav}
      unreadNotifications={unread}
    >
      {children}
    </AppShell>
  );
};

export default ParentLayout;
