import 'server-only';

import { FamilyRole, MembershipStatus, SessionStatus } from '@/generated/prisma/enums';
import { prisma } from '@/server/db/prisma';
import type { LoadedSession } from './session';

/**
 * Destination naturelle d'un utilisateur, selon l'etat de sa session.
 *
 * L'ordre reflete la politique de securite : tant que la double authentification
 * n'est pas reglee, aucun espace familial n'est accessible.
 */
export const landingDestinationFor = async (session: LoadedSession): Promise<string> => {
  if (session.status === SessionStatus.PENDING_MFA_ENROLLMENT) return '/securite/configuration';
  if (session.status === SessionStatus.PENDING_MFA) return '/securite/verification';

  const membership = await prisma.familyMembership.findFirst({
    where: { userId: session.user.id, status: MembershipStatus.ACTIVE },
    orderBy: { joinedAt: 'asc' },
    select: { role: true },
  });

  if (membership === null) return '/rejoindre';
  return membership.role === FamilyRole.CHILD ? '/enfant' : '/parent';
};
