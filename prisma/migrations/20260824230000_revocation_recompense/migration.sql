-- Revocation d'une recompense qui durait.
--
-- Purement additive : une colonne booleenne avec valeur par defaut, quatre
-- colonnes nullables, et trois valeurs d'enumeration. Aucune ligne existante
-- n'est modifiee, et `revocable = false` par defaut reproduit exactement le
-- comportement d'avant — rien ne devient retirable sans une decision explicite.

ALTER TYPE "RewardEventStatus" ADD VALUE 'REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'REWARD_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'REWARD_KEPT';
ALTER TYPE "NotificationKind" ADD VALUE 'REWARD_REVOKED';

ALTER TABLE "RewardRule" ADD COLUMN "revocable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RewardEvent"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "keptAt" TIMESTAMP(3);

ALTER TABLE "RewardEvent"
  ADD CONSTRAINT "RewardEvent_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "FamilyMembership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
