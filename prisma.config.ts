import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Configuration du CLI Prisma (migrations, generation du client).
 *
 * Elle ne concerne QUE les commandes en ligne : a l'execution, le client est
 * construit dans `src/server/db/prisma.ts` a partir de `DATABASE_URL`.
 *
 * Cette distinction compte avec un pooler comme celui de Supabase :
 *   - l'APPLICATION passe par le pooler transactionnel (port 6543), qui
 *     mutualise les connexions courtes du serverless ;
 *   - les MIGRATIONS exigent une connexion DIRECTE (port 5432), car le pooler
 *     transactionnel ne supporte pas le DDL.
 *
 * `DIRECT_DATABASE_URL` est donc utilisee en priorite ici quand elle existe.
 * Sur une base locale classique, elle est simplement absente et tout passe par
 * `DATABASE_URL`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `--conditions=react-server` fait resoudre `server-only` vers son module
    // vide : un script Node s'execute par nature cote serveur.
    seed: 'tsx --conditions=react-server prisma/seed.ts',
  },
  datasource: {
    url: process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL'],
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
