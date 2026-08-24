import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

/**
 * `server-only` est un marqueur destine au bundler de Next : il jette une erreur
 * des qu'il est charge en dehors d'un composant serveur. Les tests s'executent
 * cote Node, donc dans un contexte serveur par nature ; on le remplace par le
 * module vide que le paquet fournit precisement pour ce cas.
 */
const serverOnlyStub = fileURLToPath(
  new URL('./node_modules/server-only/empty.js', import.meta.url),
);

const aliases = { '@': srcAlias, 'server-only': serverOnlyStub };

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          globals: false,
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globals: false,
          // Les tests d'integration partagent une base PostgreSQL : chaque
          // fichier tourne dans son propre schema, mais on evite la contention.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 60_000,
          setupFiles: ['tests/integration/setup.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/domain/**/*.ts', 'src/server/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/generated/**'],
    },
  },
});
