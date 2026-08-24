import 'server-only';

import type { AuditAction } from '@/generated/prisma/enums';
import type { Db } from '@/server/db/prisma';
import { pseudonymize } from '@/server/crypto/hashing';
import type { SessionRequestContext } from '@/server/auth/session';

/**
 * Journal d'audit — distinct du ledger de points.
 *
 * Le ledger raconte les mouvements de points ; l'audit raconte QUI a decide
 * QUOI. Les deux sont append-only, mais repondent a des questions differentes
 * et n'ont pas la meme duree de conservation (voir docs/privacy.md).
 *
 * Regle absolue : aucun secret n'entre ici. Les metadonnees passent par une
 * liste blanche de cles, et toute valeur ressemblant a un secret est rejetee
 * avant l'ecriture.
 */

export type { AuditAction };

/**
 * Cles autorisees dans `metadata`. Une cle absente de cette liste est ignoree :
 * on ne peut donc pas faire fuiter accidentellement un champ sensible en
 * transmettant un objet trop large.
 */
const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'childMembershipId',
  'childName',
  'taskDefinitionId',
  'taskOccurrenceId',
  'taskTitle',
  'transactionId',
  'reversedTransactionId',
  'delta',
  'balanceBefore',
  'balanceAfter',
  'reason',
  'rewardRuleId',
  'rewardEventId',
  'sanctionRuleId',
  'sanctionInstanceId',
  'threshold',
  'score',
  'invitationId',
  'targetRole',
  'membershipId',
  'previousRole',
  'nextRole',
  'permissionsAdded',
  'permissionsRemoved',
  'sessionId',
  'credentialId',
  'credentialNickname',
  'state',
  'previousState',
  'liftConditionType',
  'occurrenceDate',
  'jobName',
  'itemsProcessed',
  'failureReason',
  'capability',
]);

/**
 * Cles interdites, quelle que soit la liste blanche : garde-fou explicite pour
 * que l'intention soit lisible a la relecture du code.
 */
const FORBIDDEN_METADATA_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'secretBase32',
  'totpSecret',
  'recoveryCode',
  'recoveryCodes',
  'otpauthUrl',
  'invitationToken',
  'sessionToken',
  'publicKey',
]);

/**
 * Les metadonnees d'audit restent scalaires : pas d'objet imbrique, donc pas de
 * risque d'embarquer par inadvertance une entite complete venue de la base.
 */
export type AuditMetadataValue = string | number | boolean | null | string[];
export type AuditMetadata = Record<string, AuditMetadataValue>;

export const sanitizeMetadata = (metadata: AuditMetadata | undefined): AuditMetadata | null => {
  if (metadata === undefined) return null;
  const clean: AuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : null;
};

export interface AuditEntry {
  readonly action: AuditAction;
  readonly summary: string;
  readonly familyId?: string | null;
  readonly actorUserId?: string | null;
  readonly actorMembershipId?: string | null;
  readonly actorLabel?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly metadata?: AuditMetadata;
  readonly request?: SessionRequestContext;
}

/**
 * Ecrit une entree d'audit.
 *
 * A appeler DANS la transaction de l'operation auditee : si l'operation echoue,
 * l'audit ne doit pas laisser croire qu'elle a eu lieu.
 */
export const recordAudit = async (db: Db, entry: AuditEntry): Promise<void> => {
  await db.auditLog.create({
    data: {
      action: entry.action,
      summary: entry.summary,
      familyId: entry.familyId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorMembershipId: entry.actorMembershipId ?? null,
      actorLabel: entry.actorLabel ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: sanitizeMetadata(entry.metadata) ?? undefined,
      ipHash: entry.request?.ip != null ? pseudonymize(entry.request.ip) : null,
      userAgentDigest:
        entry.request?.userAgent != null
          ? pseudonymize(entry.request.userAgent.slice(0, 512))
          : null,
    },
  });
};
