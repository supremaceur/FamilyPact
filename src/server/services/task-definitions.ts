import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  MembershipStatus,
  FamilyRole,
  ParentPermission,
  TaskDefinitionStatus,
  TaskRecurrence,
} from '@/generated/prisma/enums';
import { notFoundError, validationError } from '@/domain/errors';
import { assertRecurrenceIsValid } from '@/domain/tasks';
import { isLocalDate, isLocalTime, localDateTimeToInstant, toLocalDate } from '@/domain/time';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { prisma, type Db } from '@/server/db/prisma';
import { generateOccurrencesForDefinition, OCCURRENCE_HORIZON_DAYS } from './task-occurrences';

/**
 * Cycle de vie des MODELES de tache.
 *
 * Regle intangible : modifier un modele ne reecrit jamais le passe. Chaque
 * occurrence deja generee conserve son libelle et ses points ; seule la version
 * du modele est incrementee, et les occurrences FUTURES encore intactes sont
 * regenerees.
 */

const localDateSchema = z.string().refine(isLocalDate, 'Date invalide (attendu AAAA-MM-JJ).');
const localTimeSchema = z.string().refine(isLocalTime, 'Heure invalide (attendu HH:MM).');

export const taskInputSchema = z
  .object({
    childMembershipId: z.uuid(),
    title: z.string().trim().min(1, 'Le titre est obligatoire.').max(120),
    description: z.string().trim().max(1_000).nullable().default(null),
    pointsAward: z.int().min(0).max(10_000),
    pointsPenalty: z.int().min(0).max(10_000),
    recurrence: z.enum(TaskRecurrence),
    startDate: localDateSchema,
    endDate: localDateSchema.nullable().default(null),
    dueTime: localTimeSchema.nullable().default(null),
    weekdays: z.array(z.int().min(1).max(7)).max(7).default([]),
  })
  .refine((value) => value.pointsAward > 0 || value.pointsPenalty > 0, {
    message: 'Une tache doit accorder ou retirer au moins un point.',
    path: ['pointsAward'],
  });

export type TaskInput = z.infer<typeof taskInputSchema>;

/** Verifie que l'enfant vise appartient bien a la famille de l'acteur. */
const assertChildBelongsToFamily = async (
  db: Db,
  familyId: string,
  childMembershipId: string,
): Promise<{ readonly displayName: string }> => {
  const membership = await db.familyMembership.findFirst({
    where: {
      id: childMembershipId,
      familyId,
      role: FamilyRole.CHILD,
      status: MembershipStatus.ACTIVE,
    },
    select: { user: { select: { displayName: true } } },
  });
  if (membership === null) {
    throw notFoundError("Cet enfant n'existe pas dans votre famille.");
  }
  return { displayName: membership.user.displayName };
};

const resolveDueAt = (input: TaskInput, timeZone: string): Date | null => {
  if (input.recurrence !== TaskRecurrence.ONE_OFF) return null;
  if (input.dueTime === null) {
    throw validationError('Une tache ponctuelle doit avoir une heure limite.');
  }
  return localDateTimeToInstant(input.startDate, input.dueTime, timeZone);
};

export const createTaskDefinition = async (
  actor: FamilyActor,
  input: TaskInput,
): Promise<{ readonly id: string }> => {
  requireCapability(actor, ParentPermission.TASK_MANAGE);
  const parsed = taskInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const child = await assertChildBelongsToFamily(tx, actor.familyId, parsed.childMembershipId);
    const dueAt = resolveDueAt(parsed, actor.timeZone);

    assertRecurrenceIsValid({
      recurrence: parsed.recurrence,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      weekdays: parsed.weekdays,
      dueTime: parsed.dueTime,
      dueAt,
    });

    const definition = await tx.taskDefinition.create({
      data: {
        familyId: actor.familyId,
        childMembershipId: parsed.childMembershipId,
        title: parsed.title,
        description: parsed.description,
        pointsAward: parsed.pointsAward,
        pointsPenalty: parsed.pointsPenalty,
        recurrence: parsed.recurrence,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        dueTime: parsed.recurrence === TaskRecurrence.ONE_OFF ? null : parsed.dueTime,
        dueAt,
        weekdays: parsed.recurrence === TaskRecurrence.WEEKLY_DAYS ? parsed.weekdays : [],
        createdById: actor.membershipId,
      },
      select: { id: true },
    });

    await generateOccurrencesForDefinition(tx, {
      familyId: actor.familyId,
      taskDefinitionId: definition.id,
      timeZone: actor.timeZone,
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.TASK_CREATED,
      summary: `Tache « ${parsed.title} » creee pour ${child.displayName} (+${parsed.pointsAward} / -${parsed.pointsPenalty}).`,
      targetType: 'TaskDefinition',
      targetId: definition.id,
      metadata: {
        taskDefinitionId: definition.id,
        taskTitle: parsed.title,
        childMembershipId: parsed.childMembershipId,
        childName: child.displayName,
      },
    });

    return { id: definition.id };
  });
};

export const updateTaskDefinition = async (
  actor: FamilyActor,
  taskDefinitionId: string,
  input: TaskInput,
): Promise<void> => {
  requireCapability(actor, ParentPermission.TASK_MANAGE);
  const parsed = taskInputSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.taskDefinition.findFirst({
      where: { id: taskDefinitionId, familyId: actor.familyId },
      select: { id: true, version: true, title: true, childMembershipId: true },
    });
    if (existing === null) throw notFoundError('Cette tache est introuvable.');

    const child = await assertChildBelongsToFamily(tx, actor.familyId, parsed.childMembershipId);
    const dueAt = resolveDueAt(parsed, actor.timeZone);

    assertRecurrenceIsValid({
      recurrence: parsed.recurrence,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      weekdays: parsed.weekdays,
      dueTime: parsed.dueTime,
      dueAt,
    });

    await tx.taskDefinition.update({
      where: { id: taskDefinitionId },
      data: {
        childMembershipId: parsed.childMembershipId,
        title: parsed.title,
        description: parsed.description,
        pointsAward: parsed.pointsAward,
        pointsPenalty: parsed.pointsPenalty,
        recurrence: parsed.recurrence,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        dueTime: parsed.recurrence === TaskRecurrence.ONE_OFF ? null : parsed.dueTime,
        dueAt,
        weekdays: parsed.recurrence === TaskRecurrence.WEEKLY_DAYS ? parsed.weekdays : [],
        version: { increment: 1 },
      },
    });

    // Les occurrences FUTURES encore a faire sont supprimees puis regenerees.
    // Les occurrences passees, reclamees, validees ou deja jugees ne bougent pas :
    // leur libelle et leurs points restent ceux qui avaient ete annonces.
    const today = toLocalDate(new Date(), actor.timeZone);
    await tx.taskOccurrence.deleteMany({
      where: {
        taskDefinitionId,
        familyId: actor.familyId,
        state: 'TODO',
        occurrenceDate: { gt: today },
      },
    });

    await generateOccurrencesForDefinition(tx, {
      familyId: actor.familyId,
      taskDefinitionId,
      timeZone: actor.timeZone,
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.TASK_UPDATED,
      summary: `Tache « ${existing.title} » modifiee (nouvelle version pour ${child.displayName}). Les occurrences deja creees sont inchangees.`,
      targetType: 'TaskDefinition',
      targetId: taskDefinitionId,
      metadata: {
        taskDefinitionId,
        taskTitle: parsed.title,
        childMembershipId: parsed.childMembershipId,
        childName: child.displayName,
      },
    });
  });
};

export const setTaskDefinitionStatus = async (
  actor: FamilyActor,
  taskDefinitionId: string,
  status: TaskDefinitionStatus,
): Promise<void> => {
  requireCapability(actor, ParentPermission.TASK_MANAGE);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.taskDefinition.findFirst({
      where: { id: taskDefinitionId, familyId: actor.familyId },
      select: { id: true, title: true },
    });
    if (existing === null) throw notFoundError('Cette tache est introuvable.');

    await tx.taskDefinition.update({ where: { id: taskDefinitionId }, data: { status } });

    if (status !== TaskDefinitionStatus.ACTIVE) {
      // On retire les occurrences a venir non commencees, sans toucher a celles
      // qui portent deja une decision ou une declaration.
      const today = toLocalDate(new Date(), actor.timeZone);
      await tx.taskOccurrence.deleteMany({
        where: {
          taskDefinitionId,
          familyId: actor.familyId,
          state: 'TODO',
          occurrenceDate: { gt: today },
        },
      });
    } else {
      await generateOccurrencesForDefinition(tx, {
        familyId: actor.familyId,
        taskDefinitionId,
        timeZone: actor.timeZone,
      });
    }

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action:
        status === TaskDefinitionStatus.ARCHIVED
          ? AuditAction.TASK_ARCHIVED
          : AuditAction.TASK_UPDATED,
      summary: `Tache « ${existing.title} » — statut : ${status}.`,
      targetType: 'TaskDefinition',
      targetId: taskDefinitionId,
      metadata: { taskDefinitionId, taskTitle: existing.title, state: status },
    });
  });
};

export { OCCURRENCE_HORIZON_DAYS };
