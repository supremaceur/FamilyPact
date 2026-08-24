import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { getEnv } from '@/lib/env';

/**
 * Client Prisma partage.
 *
 * Prisma 7 se connecte par un adaptateur de driver : le pool `pg` est donc
 * explicite, ce qui permet de le dimensionner pour un hebergement serverless
 * comme pour un serveur long.
 *
 * En developpement, Next recharge les modules a chaud : sans le cache global
 * ci-dessous, chaque modification ouvrirait un nouveau pool de connexions.
 */
const globalForPrisma = globalThis as unknown as { familipactPrisma?: PrismaClient };

const createClient = (): PrismaClient => {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  });
};

export const prisma: PrismaClient = globalForPrisma.familipactPrisma ?? createClient();

if (!getEnv().isProduction) {
  globalForPrisma.familipactPrisma = prisma;
}

/**
 * Client transactionnel.
 *
 * Toutes les fonctions de service acceptent `Db` : soit le client global, soit
 * un client de transaction. Un appelant peut ainsi composer plusieurs
 * operations dans une seule transaction SQL — indispensable pour garder le
 * ledger et le solde cache coherents.
 */
export type PrismaTransaction = Prisma.TransactionClient;

/**
 * Le client de transaction n'expose pas `$transaction` ni `$connect`. Toutes les
 * fonctions de service se contentent donc de l'intersection utile : elles
 * peuvent etre appelees indifferemment sur le client global ou a l'interieur
 * d'une transaction, ce qui rend les operations composables.
 */
export type Db = PrismaTransaction;
