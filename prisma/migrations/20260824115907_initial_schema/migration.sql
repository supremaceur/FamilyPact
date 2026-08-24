-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('ADULT', 'CHILD');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebAuthnChallengeType" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING_MFA_ENROLLMENT', 'PENDING_MFA', 'ACTIVE');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'ADMIN', 'PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ParentPermission" AS ENUM ('TASK_MANAGE', 'TASK_APPROVE', 'TASK_CONFIRM_MISSED', 'POINTS_ADJUST', 'RULE_MANAGE', 'REWARD_APPROVE', 'SANCTION_ACTIVATE', 'SANCTION_LIFT', 'CHILD_MANAGE', 'FAMILY_SETTINGS_MANAGE', 'AUDIT_VIEW');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'CONSUMED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TaskRecurrence" AS ENUM ('ONE_OFF', 'DAILY', 'WEEKLY_DAYS');

-- CreateEnum
CREATE TYPE "TaskDefinitionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskOccurrenceState" AS ENUM ('TODO', 'CLAIMED_DONE', 'APPROVED', 'REJECTED', 'MISSED_PENDING_REVIEW', 'MISSED_CONFIRMED', 'MISSED_IGNORED');

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('TASK_APPROVED', 'TASK_MISSED', 'MANUAL_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PointTransactionSource" AS ENUM ('TASK_OCCURRENCE', 'MANUAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RewardRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RewardEventStatus" AS ENUM ('PENDING_PARENT_APPROVAL', 'GRANTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SanctionRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScoreComparator" AS ENUM ('LT', 'LTE');

-- CreateEnum
CREATE TYPE "LiftConditionType" AS ENUM ('MANUAL', 'DATE', 'SCORE', 'DATE_AND_SCORE', 'DATE_OR_SCORE');

-- CreateEnum
CREATE TYPE "SanctionInstanceStatus" AS ENUM ('PROPOSED', 'IGNORED', 'ACTIVE', 'LIFT_ELIGIBLE', 'LIFTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_CLAIM_PENDING', 'TASK_MISSED_PENDING', 'REWARD_PROPOSED', 'SANCTION_PROPOSED', 'SANCTION_LIFT_ELIGIBLE', 'TASK_APPROVED', 'TASK_REJECTED', 'TASK_MISSED_CONFIRMED', 'POINTS_ADJUSTED', 'REWARD_GRANTED', 'SANCTION_ACTIVATED', 'SANCTION_LIFTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PARENT_LOGIN_SUCCEEDED', 'PARENT_LOGIN_FAILED', 'CHILD_LOGIN_SUCCEEDED', 'CHILD_LOGIN_FAILED', 'MFA_ENROLLED', 'MFA_VERIFICATION_FAILED', 'MFA_RESET', 'RECOVERY_CODES_GENERATED', 'RECOVERY_CODE_USED', 'PASSKEY_REGISTERED', 'PASSKEY_REMOVED', 'SESSION_REVOKED', 'STEP_UP_GRANTED', 'PASSWORD_CHANGED', 'FAMILY_CREATED', 'FAMILY_SETTINGS_UPDATED', 'FAMILY_DELETED', 'OWNERSHIP_TRANSFERRED', 'INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_CONSUMED', 'INVITATION_REJECTED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED', 'MEMBER_PERMISSIONS_UPDATED', 'CHILD_CREATED', 'CHILD_UPDATED', 'CHILD_DELETED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_ARCHIVED', 'TASK_CLAIMED', 'TASK_APPROVED', 'TASK_REJECTED', 'TASK_MISSED_DETECTED', 'TASK_MISSED_CONFIRMED', 'TASK_MISSED_IGNORED', 'POINTS_ADJUSTED', 'POINTS_REVERSED', 'REWARD_RULE_CREATED', 'REWARD_RULE_UPDATED', 'REWARD_RULE_ARCHIVED', 'REWARD_PROPOSED', 'REWARD_GRANTED', 'REWARD_IGNORED', 'SANCTION_RULE_CREATED', 'SANCTION_RULE_UPDATED', 'SANCTION_RULE_ARCHIVED', 'SANCTION_PROPOSED', 'SANCTION_ACTIVATED', 'SANCTION_IGNORED', 'SANCTION_LIFT_ELIGIBLE', 'SANCTION_LIFTED', 'AUTHORIZATION_DENIED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "loginId" TEXT,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotpCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretNonce" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "period" INTEGER NOT NULL DEFAULT 30,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedTimeStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "nickname" TEXT NOT NULL,
    "aaguid" TEXT,
    "platformBound" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "WebAuthnChallengeType" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL,
    "authMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "elevatedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "ipHash" TEXT,
    "userAgentDigest" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMembership" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentPermissionGrant" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "permission" "ParentPermission" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "ParentPermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildProfile" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "avatarKey" TEXT NOT NULL DEFAULT 'fox',
    "colorKey" TEXT NOT NULL DEFAULT 'sage',
    "cachedBalance" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "balanceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "targetRole" "FamilyRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDefinition" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pointsAward" INTEGER NOT NULL,
    "pointsPenalty" INTEGER NOT NULL DEFAULT 0,
    "recurrence" "TaskRecurrence" NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "dueTime" TEXT,
    "dueAt" TIMESTAMP(3),
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "TaskDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "taskDefinitionId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "occurrenceDate" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "state" "TaskOccurrenceState" NOT NULL DEFAULT 'TODO',
    "titleSnapshot" TEXT NOT NULL,
    "pointsAwardSnapshot" INTEGER NOT NULL,
    "pointsPenaltySnapshot" INTEGER NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "missedDetectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "sourceType" "PointTransactionSource" NOT NULL,
    "sourceId" TEXT,
    "label" TEXT NOT NULL,
    "reason" TEXT,
    "approvedById" TEXT,
    "reversesTransactionId" TEXT,
    "idempotencyKey" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RewardRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "rewardRuleId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "status" "RewardEventStatus" NOT NULL DEFAULT 'PENDING_PARENT_APPROVAL',
    "titleSnapshot" TEXT NOT NULL,
    "thresholdSnapshot" INTEGER NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreAtProposal" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionRule" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "comparator" "ScoreComparator" NOT NULL DEFAULT 'LT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "liftConditionType" "LiftConditionType" NOT NULL DEFAULT 'MANUAL',
    "liftScoreThreshold" INTEGER,
    "liftDurationDays" INTEGER,
    "status" "SanctionRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "armed" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SanctionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionInstance" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "sanctionRuleId" TEXT NOT NULL,
    "childMembershipId" TEXT NOT NULL,
    "status" "SanctionInstanceStatus" NOT NULL DEFAULT 'PROPOSED',
    "titleSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "thresholdSnapshot" INTEGER NOT NULL,
    "comparatorSnapshot" "ScoreComparator" NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreAtProposal" INTEGER NOT NULL,
    "liftConditionType" "LiftConditionType" NOT NULL DEFAULT 'MANUAL',
    "liftAt" TIMESTAMP(3),
    "liftScoreThreshold" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "ignoredAt" TIMESTAMP(3),
    "ignoredById" TEXT,
    "liftEligibleAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SanctionInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "familyId" TEXT,
    "actorUserId" TEXT,
    "actorMembershipId" TEXT,
    "actorLabel" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgentDigest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE INDEX "User_kind_status_idx" ON "User"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TotpCredential_userId_key" ON "TotpCredential"("userId");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_usedAt_idx" ON "RecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_idleExpiresAt_idx" ON "Session"("idleExpiresAt");

-- CreateIndex
CREATE INDEX "FamilyMembership_familyId_role_status_idx" ON "FamilyMembership"("familyId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMembership_familyId_userId_key" ON "FamilyMembership"("familyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMembership_id_familyId_key" ON "FamilyMembership"("id", "familyId");

-- CreateIndex
CREATE INDEX "ParentPermissionGrant_membershipId_idx" ON "ParentPermissionGrant"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentPermissionGrant_membershipId_permission_key" ON "ParentPermissionGrant"("membershipId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "ChildProfile_membershipId_key" ON "ChildProfile"("membershipId");

-- CreateIndex
CREATE INDEX "ChildProfile_familyId_idx" ON "ChildProfile"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_familyId_status_idx" ON "Invitation"("familyId", "status");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE INDEX "TaskDefinition_familyId_status_idx" ON "TaskDefinition"("familyId", "status");

-- CreateIndex
CREATE INDEX "TaskDefinition_childMembershipId_status_idx" ON "TaskDefinition"("childMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDefinition_id_familyId_key" ON "TaskDefinition"("id", "familyId");

-- CreateIndex
CREATE INDEX "TaskOccurrence_familyId_state_idx" ON "TaskOccurrence"("familyId", "state");

-- CreateIndex
CREATE INDEX "TaskOccurrence_childMembershipId_state_idx" ON "TaskOccurrence"("childMembershipId", "state");

-- CreateIndex
CREATE INDEX "TaskOccurrence_familyId_dueAt_state_idx" ON "TaskOccurrence"("familyId", "dueAt", "state");

-- CreateIndex
CREATE INDEX "TaskOccurrence_state_dueAt_idx" ON "TaskOccurrence"("state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskDefinitionId_occurrenceDate_key" ON "TaskOccurrence"("taskDefinitionId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_id_familyId_key" ON "TaskOccurrence"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_reversesTransactionId_key" ON "PointTransaction"("reversesTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_idempotencyKey_key" ON "PointTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointTransaction_familyId_createdAt_idx" ON "PointTransaction"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "PointTransaction_childMembershipId_createdAt_idx" ON "PointTransaction"("childMembershipId", "createdAt");

-- CreateIndex
CREATE INDEX "PointTransaction_familyId_type_createdAt_idx" ON "PointTransaction"("familyId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_sourceType_sourceId_type_key" ON "PointTransaction"("sourceType", "sourceId", "type");

-- CreateIndex
CREATE INDEX "RewardRule_familyId_status_idx" ON "RewardRule"("familyId", "status");

-- CreateIndex
CREATE INDEX "RewardRule_childMembershipId_status_threshold_idx" ON "RewardRule"("childMembershipId", "status", "threshold");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRule_id_familyId_key" ON "RewardRule"("id", "familyId");

-- CreateIndex
CREATE INDEX "RewardEvent_familyId_status_idx" ON "RewardEvent"("familyId", "status");

-- CreateIndex
CREATE INDEX "RewardEvent_childMembershipId_status_idx" ON "RewardEvent"("childMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEvent_rewardRuleId_childMembershipId_key" ON "RewardEvent"("rewardRuleId", "childMembershipId");

-- CreateIndex
CREATE INDEX "SanctionRule_familyId_status_idx" ON "SanctionRule"("familyId", "status");

-- CreateIndex
CREATE INDEX "SanctionRule_childMembershipId_status_idx" ON "SanctionRule"("childMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SanctionRule_id_familyId_key" ON "SanctionRule"("id", "familyId");

-- CreateIndex
CREATE INDEX "SanctionInstance_familyId_status_idx" ON "SanctionInstance"("familyId", "status");

-- CreateIndex
CREATE INDEX "SanctionInstance_childMembershipId_status_idx" ON "SanctionInstance"("childMembershipId", "status");

-- CreateIndex
CREATE INDEX "SanctionInstance_status_liftAt_idx" ON "SanctionInstance"("status", "liftAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientMembershipId_readAt_createdAt_idx" ON "Notification"("recipientMembershipId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_familyId_createdAt_idx" ON "Notification"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_action_createdAt_idx" ON "AuditLog"("familyId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobName_runKey_key" ON "JobRun"("jobName", "runKey");

-- CreateIndex
CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_bucketKey_windowStartedAt_key" ON "RateLimitCounter"("bucketKey", "windowStartedAt");

-- AddForeignKey
ALTER TABLE "TotpCredential" ADD CONSTRAINT "TotpCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentPermissionGrant" ADD CONSTRAINT "ParentPermissionGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FamilyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildProfile" ADD CONSTRAINT "ChildProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FamilyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_consumedByUserId_fkey" FOREIGN KEY ("consumedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDefinition" ADD CONSTRAINT "TaskDefinition_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDefinition" ADD CONSTRAINT "TaskDefinition_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDefinition" ADD CONSTRAINT "TaskDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskDefinitionId_familyId_fkey" FOREIGN KEY ("taskDefinitionId", "familyId") REFERENCES "TaskDefinition"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "PointTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_rewardRuleId_familyId_fkey" FOREIGN KEY ("rewardRuleId", "familyId") REFERENCES "RewardRule"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionRule" ADD CONSTRAINT "SanctionRule_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionRule" ADD CONSTRAINT "SanctionRule_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionRule" ADD CONSTRAINT "SanctionRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_sanctionRuleId_familyId_fkey" FOREIGN KEY ("sanctionRuleId", "familyId") REFERENCES "SanctionRule"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_childMembershipId_familyId_fkey" FOREIGN KEY ("childMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_ignoredById_fkey" FOREIGN KEY ("ignoredById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionInstance" ADD CONSTRAINT "SanctionInstance_liftedById_fkey" FOREIGN KEY ("liftedById") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientMembershipId_familyId_fkey" FOREIGN KEY ("recipientMembershipId", "familyId") REFERENCES "FamilyMembership"("id", "familyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "FamilyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
