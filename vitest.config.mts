import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcAlias },
  },
  test: {
    projects: [
      {
        resolve: { alias: { '@': srcAlias } },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          globals: false,
        },
      },
      {
        resolve: { alias: { '@': srcAlias } },
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
