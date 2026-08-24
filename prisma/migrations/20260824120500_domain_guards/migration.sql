-- ---------------------------------------------------------------------------
-- FamiliPact — garanties structurelles ecrites a la main.
--
-- Prisma ne sait exprimer ni les index uniques partiels, ni les contraintes
-- CHECK, ni les triggers. Ces regles sont pourtant des invariants metier
-- critiques : elles doivent tenir meme si le code applicatif est contourne.
-- ---------------------------------------------------------------------------

-- 1. Il existe AU PLUS un OWNER actif par famille.
--    (Le "au moins un" est garanti par le service : la creation de famille cree
--     l'OWNER, et un transfert de propriete est atomique.)
CREATE UNIQUE INDEX "family_single_active_owner"
  ON "FamilyMembership" ("familyId")
  WHERE "role" = 'OWNER' AND "status" = 'ACTIVE';

-- 2. Une regle de sanction n'a jamais deux episodes ouverts simultanement pour
--    le meme enfant. Empeche les propositions en double, y compris en cas de
--    double execution d'un job.
CREATE UNIQUE INDEX "sanction_single_open_instance"
  ON "SanctionInstance" ("sanctionRuleId", "childMembershipId")
  WHERE "status" IN ('PROPOSED', 'ACTIVE', 'LIFT_ELIGIBLE');

-- 3. Coherence des valeurs metier.
ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "point_transaction_delta_not_zero" CHECK ("delta" <> 0);

ALTER TABLE "TaskDefinition"
  ADD CONSTRAINT "task_definition_points_non_negative"
  CHECK ("pointsAward" >= 0 AND "pointsPenalty" >= 0);

ALTER TABLE "TaskOccurrence"
  ADD CONSTRAINT "task_occurrence_points_non_negative"
  CHECK ("pointsAwardSnapshot" >= 0 AND "pointsPenaltySnapshot" >= 0);

ALTER TABLE "TaskDefinition"
  ADD CONSTRAINT "task_definition_weekdays_required"
  CHECK (
    "recurrence" <> 'WEEKLY_DAYS'
    OR (array_length("weekdays", 1) BETWEEN 1 AND 7)
  );

ALTER TABLE "TaskDefinition"
  ADD CONSTRAINT "task_definition_due_shape"
  CHECK (
    ("recurrence" = 'ONE_OFF' AND "dueAt" IS NOT NULL)
    OR ("recurrence" <> 'ONE_OFF' AND "dueTime" IS NOT NULL)
  );

-- Un motif est obligatoire des qu'un parent corrige le ledger a la main.
ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "point_transaction_reason_required"
  CHECK (
    "type" NOT IN ('MANUAL_ADJUSTMENT', 'REVERSAL')
    OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)
  );

-- Une transaction de type REVERSAL pointe toujours la transaction annulee.
ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "point_transaction_reversal_target"
  CHECK (
    ("type" = 'REVERSAL') = ("reversesTransactionId" IS NOT NULL)
  );

-- Un profil enfant n'existe que pour une adhesion de role CHILD : verifie par
-- le service (une contrainte SQL exigerait une jointure, impossible en CHECK).

-- 4. Journaux append-only.
--
--    `PointTransaction` et `AuditLog` n'acceptent que des INSERT. Une erreur se
--    corrige par une ecriture inverse, jamais par une reecriture silencieuse.
--
--    Seule exception : l'effacement RGPD (suppression d'une famille ou d'un
--    enfant), qui doit poser explicitement le drapeau de session
--    `familipact.purge = 'on'` DANS la transaction concernee. Le drapeau est
--    pose avec SET LOCAL : il retombe a la fin de la transaction.
CREATE OR REPLACE FUNCTION familipact_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('familipact.purge', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'La table % est en append-only : % interdit. Utilisez une ecriture inverse.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "point_transaction_append_only"
  BEFORE UPDATE OR DELETE ON "PointTransaction"
  FOR EACH ROW EXECUTE FUNCTION familipact_append_only_guard();

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION familipact_append_only_guard();

-- 5. Index complementaires pour les ecrans "actions requises" et l'historique.
CREATE INDEX "task_occurrence_pending_parent_review"
  ON "TaskOccurrence" ("familyId", "state", "dueAt")
  WHERE "state" IN ('CLAIMED_DONE', 'MISSED_PENDING_REVIEW');

CREATE INDEX "reward_event_pending_review"
  ON "RewardEvent" ("familyId", "proposedAt")
  WHERE "status" = 'PENDING_PARENT_APPROVAL';

CREATE INDEX "sanction_instance_needing_attention"
  ON "SanctionInstance" ("familyId", "status")
  WHERE "status" IN ('PROPOSED', 'LIFT_ELIGIBLE');

CREATE INDEX "notification_unread"
  ON "Notification" ("recipientMembershipId", "createdAt")
  WHERE "readAt" IS NULL;
