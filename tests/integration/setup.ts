import 'dotenv/config';

/**
 * Configuration commune aux tests d'integration.
 *
 * `DATABASE_URL` est bascule sur la base de tests AVANT que le moindre module
 * applicatif ne soit importe : le client Prisma lit cette valeur a sa creation.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (testDatabaseUrl === undefined || testDatabaseUrl.length === 0) {
  throw new Error("TEST_DATABASE_URL est obligatoire pour les tests d'integration.");
}

// `process.env.NODE_ENV` est type en lecture seule par @types/node ; l'ecriture
// est pourtant necessaire ici, avant tout import applicatif.
const env = process.env as Record<string, string | undefined>;

env['DATABASE_URL'] = testDatabaseUrl;
env['NODE_ENV'] = 'test';
env['APP_ORIGIN'] ??= 'http://localhost:3000';
env['WEBAUTHN_RP_ID'] ??= 'localhost';
env['WEBAUTHN_RP_NAME'] ??= 'FamiliPact';
env['JOB_RUNNER_TOKEN'] ??= 'test-job-runner-token-0123456789';
