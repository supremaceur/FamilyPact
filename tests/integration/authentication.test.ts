import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditAction, SessionStatus, UserKind } from '@/generated/prisma/enums';
import { DomainError } from '@/domain/errors';
import { prisma } from '@/server/db/prisma';
import { hashLookupToken } from '@/server/crypto/hashing';
import { MAX_FAILED_LOGINS, RATE_LIMITS, consumeRateLimit } from '@/server/auth/rate-limit';
import {
  createSession,
  isElevated,
  loadSessionByToken,
  promoteSession,
  revokeAllSessionsForUser,
  revokeSession,
} from '@/server/auth/session';
import { generateTotpSecret, verifyEnrollmentCode, verifyTotpCode } from '@/server/auth/totp';
import { findMatchingRecoveryCode, generateRecoveryCodes } from '@/server/auth/recovery-codes';
import { login, registerParentAndFamily } from '@/server/services/accounts';

/**
 * Authentification : politique MFA, sessions, TOTP, codes de recuperation,
 * protections contre l'enumeration et la force brute.
 */

const REQUEST = { ip: '203.0.113.10', userAgent: 'vitest' };

let suffix = 0;
const uniqueEmail = (): string => {
  suffix += 1;
  return `parent.auth.${suffix}.${Date.now()}@example.test`;
};

beforeEach(async () => {
  // Les compteurs de rate limiting sont partages : on repart propre pour que
  // les tests restent independants les uns des autres.
  await prisma.rateLimitCounter.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('creation de compte parent', () => {
  it("ouvre une session en attente d'enrolement MFA, sans acces familial", async () => {
    const email = uniqueEmail();
    const result = await registerParentAndFamily(
      {
        email,
        password: 'une phrase de passe robuste',
        displayName: 'Marie',
        familyName: 'Famille Durand',
        timeZone: 'Europe/Paris',
      },
      REQUEST,
    );

    expect(result.session.status).toBe(SessionStatus.PENDING_MFA_ENROLLMENT);

    const loaded = await loadSessionByToken(prisma, result.session.token);
    expect(loaded?.status).toBe(SessionStatus.PENDING_MFA_ENROLLMENT);
    expect(loaded?.user.hasConfirmedTotp).toBe(false);

    // Le proprietaire est cree, et il est unique.
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId: result.familyId },
      select: { role: true },
    });
    expect(memberships).toEqual([{ role: 'OWNER' }]);
  });

  it('refuse une seconde inscription avec la meme adresse', async () => {
    const email = uniqueEmail();
    const input = {
      email,
      password: 'une phrase de passe robuste',
      displayName: 'Marie',
      familyName: 'Famille Durand',
      timeZone: 'Europe/Paris',
    };
    await registerParentAndFamily(input, REQUEST);
    await expect(registerParentAndFamily(input, REQUEST)).rejects.toThrow(DomainError);
  });

  it('refuse un mot de passe trop court ou trop courant', async () => {
    await expect(
      registerParentAndFamily(
        {
          email: uniqueEmail(),
          password: 'court',
          displayName: 'Marie',
          familyName: 'Famille',
          timeZone: 'Europe/Paris',
        },
        REQUEST,
      ),
    ).rejects.toThrow();

    await expect(
      registerParentAndFamily(
        {
          email: uniqueEmail(),
          password: 'motdepasse123',
          displayName: 'Marie',
          familyName: 'Famille',
          timeZone: 'Europe/Paris',
        },
        REQUEST,
      ),
    ).rejects.toThrow();
  });

  it('stocke le mot de passe hashe en Argon2id, jamais en clair', async () => {
    const email = uniqueEmail();
    const password = 'une phrase de passe robuste';
    await registerParentAndFamily(
      {
        email,
        password,
        displayName: 'Marie',
        familyName: 'Famille',
        timeZone: 'Europe/Paris',
      },
      REQUEST,
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
  });
});

describe('connexion', () => {
  const registerParent = async (): Promise<{ email: string; password: string }> => {
    const email = uniqueEmail();
    const password = 'une phrase de passe robuste';
    await registerParentAndFamily(
      {
        email,
        password,
        displayName: 'Marie',
        familyName: 'Famille',
        timeZone: 'Europe/Paris',
      },
      REQUEST,
    );
    return { email, password };
  };

  it("n'ouvre jamais une session complete sur le seul mot de passe", async () => {
    const { email, password } = await registerParent();

    // Le TOTP est confirme : la connexion doit donc exiger le second facteur.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const generated = generateTotpSecret(user.id, email);
    await prisma.totpCredential.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        secretCiphertext: generated.sealed.ciphertext,
        secretNonce: generated.sealed.nonce,
        secretAuthTag: generated.sealed.authTag,
        confirmedAt: new Date(),
      },
      update: { confirmedAt: new Date() },
    });

    const result = await login({ identifier: email, password }, REQUEST);
    expect(result.session.status).toBe(SessionStatus.PENDING_MFA);
    expect(result.nextStep).toBe('MFA_VERIFICATION');
  });

  it('renvoie le meme message pour un compte inconnu et un mot de passe faux', async () => {
    const { email } = await registerParent();

    const unknownAccount = await login(
      { identifier: 'inconnu@example.test', password: 'peu importe' },
      REQUEST,
    ).catch((error: unknown) => error);
    const wrongPassword = await login(
      { identifier: email, password: 'mauvais mot de passe' },
      REQUEST,
    ).catch((error: unknown) => error);

    expect(unknownAccount).toBeInstanceOf(DomainError);
    expect(wrongPassword).toBeInstanceOf(DomainError);
    // Aucune information ne distingue les deux cas : pas d'enumeration possible.
    expect((unknownAccount as DomainError).message).toBe((wrongPassword as DomainError).message);
    expect((unknownAccount as DomainError).code).toBe((wrongPassword as DomainError).code);
  });

  it('journalise les echecs de connexion sans jamais consigner le mot de passe', async () => {
    const { email } = await registerParent();
    await login({ identifier: email, password: 'mauvais' }, REQUEST).catch(() => null);

    const entries = await prisma.auditLog.findMany({
      where: { action: AuditAction.PARENT_LOGIN_FAILED },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { summary: true, metadata: true, ipHash: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).not.toContain('mauvais');
    expect(JSON.stringify(entries[0]!.metadata ?? {})).not.toContain('mauvais');
    // L'adresse IP est pseudonymisee, jamais stockee en clair.
    expect(entries[0]!.ipHash).not.toBe(REQUEST.ip);
    expect(entries[0]!.ipHash).not.toBeNull();
  });

  it('applique deux protections successives contre la force brute', async () => {
    const { email, password } = await registerParent();

    // PREMIERE BARRIERE — le rate limit par identifiant se declenche avant meme
    // que le compteur d'echecs du compte n'arrive a son seuil.
    for (let attempt = 0; attempt < RATE_LIMITS.loginByIdentifier.limit; attempt += 1) {
      await login({ identifier: email, password: 'mauvais' }, REQUEST).catch(() => null);
    }
    await expect(login({ identifier: email, password: 'mauvais' }, REQUEST)).rejects.toThrow(
      /trop de tentatives/i,
    );

    // SECONDE BARRIERE — meme si l'attaquant attend la fenetre suivante, le
    // compte finit par se verrouiller temporairement.
    await prisma.rateLimitCounter.deleteMany({});
    while (true) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { failedLoginCount: true, lockedUntil: true },
      });
      if (user.lockedUntil !== null) break;
      if (user.failedLoginCount >= MAX_FAILED_LOGINS) break;
      await login({ identifier: email, password: 'mauvais' }, REQUEST).catch(() => null);
      await prisma.rateLimitCounter.deleteMany({});
    }

    // Meme avec le bon mot de passe, le compte reste verrouille.
    await expect(login({ identifier: email, password }, REQUEST)).rejects.toThrow(/verrouille/i);
  });

  it('ouvre directement une session complete pour un enfant', async () => {
    const child = await prisma.user.create({
      data: {
        kind: UserKind.CHILD,
        loginId: `enfant.login.${Date.now()}`,
        displayName: 'Lucas',
        // Hash Argon2id du mot de passe utilise ci-dessous.
        passwordHash: await import('@/server/crypto/hashing').then((module) =>
          module.hashPassword('mot de passe enfant'),
        ),
      },
      select: { loginId: true },
    });

    const result = await login(
      { identifier: child.loginId!, password: 'mot de passe enfant' },
      REQUEST,
    );
    expect(result.session.status).toBe(SessionStatus.ACTIVE);
    expect(result.nextStep).toBe('READY');
    expect(result.userKind).toBe(UserKind.CHILD);
  });
});

describe('sessions', () => {
  const createUser = async () =>
    prisma.user.create({
      data: {
        kind: UserKind.ADULT,
        email: uniqueEmail(),
        displayName: 'Session',
        passwordHash: 'hash',
        totpCredential: {
          create: {
            secretCiphertext: 'x',
            secretNonce: 'x',
            secretAuthTag: 'x',
            confirmedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });

  it('ne stocke que le hash du jeton de session', async () => {
    const user = await createUser();
    const session = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      request: REQUEST,
    });

    const stored = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
      select: { tokenHash: true },
    });
    expect(stored.tokenHash).toBe(hashLookupToken(session.token));
    expect(stored.tokenHash).not.toBe(session.token);
  });

  it('fait tourner le jeton apres la verification du second facteur', async () => {
    const user = await createUser();
    const pending = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.PENDING_MFA,
      authMethods: ['password'],
      request: REQUEST,
    });

    const promoted = await promoteSession(prisma, {
      sessionId: pending.sessionId,
      authMethod: 'totp',
      request: REQUEST,
    });

    // Protection contre la fixation de session : nouveau jeton, ancien revoque.
    expect(promoted.token).not.toBe(pending.token);
    expect(await loadSessionByToken(prisma, pending.token)).toBeNull();

    const active = await loadSessionByToken(prisma, promoted.token);
    expect(active?.status).toBe(SessionStatus.ACTIVE);
    expect(active?.authMethods).toEqual(['password', 'totp']);
  });

  it("ne prolonge pas l'expiration absolue lors de la promotion", async () => {
    const user = await createUser();
    const pending = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.PENDING_MFA,
      authMethods: ['password'],
      request: REQUEST,
    });
    const before = await prisma.session.findUniqueOrThrow({
      where: { id: pending.sessionId },
      select: { absoluteExpiresAt: true },
    });

    const promoted = await promoteSession(prisma, {
      sessionId: pending.sessionId,
      authMethod: 'totp',
      request: REQUEST,
    });
    expect(promoted.absoluteExpiresAt).toEqual(before.absoluteExpiresAt);
  });

  it('rejette une session revoquee ou expiree', async () => {
    const user = await createUser();
    const session = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      request: REQUEST,
    });

    await revokeSession(prisma, session.sessionId, 'test');
    expect(await loadSessionByToken(prisma, session.token)).toBeNull();

    const other = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      request: REQUEST,
    });
    await prisma.session.update({
      where: { id: other.sessionId },
      data: { idleExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await loadSessionByToken(prisma, other.token)).toBeNull();
  });

  it("revoque toutes les sessions d'un utilisateur", async () => {
    const user = await createUser();
    const first = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password'],
      request: REQUEST,
    });
    const second = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password'],
      request: REQUEST,
    });

    const revoked = await revokeAllSessionsForUser(prisma, user.id, 'membership_removed');
    expect(revoked).toBe(2);
    expect(await loadSessionByToken(prisma, first.token)).toBeNull();
    expect(await loadSessionByToken(prisma, second.token)).toBeNull();
  });

  it("n'eleve une session que pendant une fenetre courte", async () => {
    const user = await createUser();
    const session = await createSession(prisma, {
      userId: user.id,
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      request: REQUEST,
      elevated: true,
    });
    const loaded = await loadSessionByToken(prisma, session.token);

    expect(isElevated(loaded!)).toBe(true);
    // Une heure plus tard, la fenetre sensible est refermee.
    expect(isElevated(loaded!, new Date(Date.now() + 3_600_000))).toBe(false);
  });
});

describe('TOTP', () => {
  it('valide un code genere a partir du secret, puis refuse son rejeu', async () => {
    const userId = 'user-totp-test';
    const generated = generateTotpSecret(userId, 'marie@example.test');

    // Un code correct est accepte lors de l'enrolement.
    const { TOTP, Secret } = await import('otpauth');
    const totp = new TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(generated.base32),
    });
    const code = totp.generate();

    const enrollment = verifyEnrollmentCode(generated.base32, code);
    expect(enrollment.valid).toBe(true);
    expect(enrollment.timeStep).not.toBeNull();

    const stored = {
      secretCiphertext: generated.sealed.ciphertext,
      secretNonce: generated.sealed.nonce,
      secretAuthTag: generated.sealed.authTag,
    };

    // Le meme code, une fois son pas de temps consomme, est refuse.
    const replay = verifyTotpCode(stored, userId, code, {
      lastUsedTimeStep: BigInt(enrollment.timeStep!),
    });
    expect(replay.valid).toBe(false);
  });

  it('refuse un code invalide et un code mal forme', () => {
    const userId = 'user-totp-invalid';
    const generated = generateTotpSecret(userId, 'marie@example.test');
    const stored = {
      secretCiphertext: generated.sealed.ciphertext,
      secretNonce: generated.sealed.nonce,
      secretAuthTag: generated.sealed.authTag,
    };

    expect(verifyTotpCode(stored, userId, '000000', { lastUsedTimeStep: null }).valid).toBe(false);
    expect(verifyTotpCode(stored, userId, 'abcdef', { lastUsedTimeStep: null }).valid).toBe(false);
    expect(verifyTotpCode(stored, userId, '12345', { lastUsedTimeStep: null }).valid).toBe(false);
  });

  it('refuse un secret dechiffre pour un autre compte', () => {
    const generated = generateTotpSecret('user-a', 'a@example.test');
    const stored = {
      secretCiphertext: generated.sealed.ciphertext,
      secretNonce: generated.sealed.nonce,
      secretAuthTag: generated.sealed.authTag,
    };
    // Le chiffrement est lie a l'identifiant du compte : deplacer le secret
    // vers un autre utilisateur le rend inutilisable.
    expect(verifyTotpCode(stored, 'user-b', '123456', { lastUsedTimeStep: null }).valid).toBe(
      false,
    );
  });

  it('produit une URI otpauth exploitable par les applications standard', () => {
    const generated = generateTotpSecret('user-uri', 'marie@example.test');
    expect(generated.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(generated.otpauthUrl).toContain('algorithm=SHA1');
    expect(generated.otpauthUrl).toContain('digits=6');
    expect(generated.otpauthUrl).toContain('period=30');
  });
});

describe('codes de recuperation', () => {
  it('emet des codes hashes, jamais stockables en clair', async () => {
    const generated = await generateRecoveryCodes();
    expect(generated.plaintext).toHaveLength(10);
    expect(generated.records).toHaveLength(10);

    for (const [index, record] of generated.records.entries()) {
      expect(record.codeHash).toMatch(/^\$argon2id\$/);
      expect(record.codeHash).not.toContain(generated.plaintext[index]!);
    }
  });

  it('reconnait un code valide et rejette un code inconnu', async () => {
    const generated = await generateRecoveryCodes();
    const candidates = generated.records.map((record, index) => ({
      id: `code-${index}`,
      codeHash: record.codeHash,
    }));

    const match = await findMatchingRecoveryCode(candidates, generated.plaintext[3]!);
    expect(match?.id).toBe('code-3');

    expect(await findMatchingRecoveryCode(candidates, 'ZZZZ-ZZZZ-ZZ')).toBeNull();
  });
});

describe('rate limiting', () => {
  it('bloque au-dela de la limite, puis repart a la fenetre suivante', async () => {
    const policy = RATE_LIMITS.loginByIdentifier;
    const subject = `test-subject-${Date.now()}`;

    for (let attempt = 0; attempt < policy.limit; attempt += 1) {
      await consumeRateLimit(prisma, 'loginByIdentifier', subject);
    }
    await expect(consumeRateLimit(prisma, 'loginByIdentifier', subject)).rejects.toThrow(
      /trop de tentatives/i,
    );

    // Fenetre suivante : le compteur repart de zero.
    const nextWindow = new Date(Date.now() + policy.windowSeconds * 1_000);
    await expect(
      consumeRateLimit(prisma, 'loginByIdentifier', subject, nextWindow),
    ).resolves.toBeUndefined();
  });
});
