import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

/**
 * Tests de bout en bout.
 *
 * Ils tournent contre l'application REELLE, construite en mode production et
 * branchee sur la base de test : c'est le seul moyen de verifier ce que voit
 * reellement un parent ou un enfant, service worker et rendu serveur compris.
 *
 * Le viewport par defaut est celui d'un telephone : FamiliPact est concu
 * mobile-first, les parcours critiques doivent donc etre valides d'abord la.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Certains environnements fournissent deja un Chromium, dont la version ne
 * correspond pas forcement a celle attendue par cette version de Playwright.
 * Quand ce binaire existe, on l'utilise plutot que d'en telecharger un autre ;
 * sinon Playwright retombe sur son navigateur habituel.
 */
const PREINSTALLED_CHROMIUM =
  process.env['PLAYWRIGHT_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const chromiumLaunch = existsSync(PREINSTALLED_CHROMIUM)
  ? { launchOptions: { executablePath: PREINSTALLED_CHROMIUM } }
  : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: process.env['CI'] === 'true' ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] === 'true' ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    },
  ],

  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '',
      APP_ORIGIN: baseURL,
      WEBAUTHN_RP_ID: '127.0.0.1',
      NODE_ENV: 'production',
    },
  },
});
