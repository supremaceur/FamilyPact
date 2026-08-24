import { execSync } from 'node:child_process';
import { Client } from 'pg';
import 'dotenv/config';

/**
 * Prepare la base des tests d'integration.
 *
 * Les tests tournent contre un VRAI PostgreSQL, jamais contre un double : les
 * garanties les plus importantes de FamiliPact (unicite du ledger, index
 * uniques partiels, triggers append-only, cles etrangeres composites) sont
 * portees par la base. Les simuler reviendrait a ne rien tester.
 *
 * Le schema est recree de zero puis les migrations sont rejouees : la suite
 * verifie donc aussi qu'elles s'appliquent proprement sur une base vierge.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      "TEST_DATABASE_URL est obligatoire pour les tests d'integration (voir .env.example).",
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
