import { expect, test } from '@playwright/test';

/**
 * Parcours critiques de bout en bout.
 *
 * Ces tests couvrent ce qu'aucun test unitaire ne peut garantir : que
 * l'application demarre reellement, que la PWA est installable, que les
 * redirections d'authentification fonctionnent, et qu'aucun espace prive
 * n'est atteignable sans session.
 *
 * Le parcours complet parent (creation de compte, TOTP, validation d'une
 * tache) est couvert par les tests d'integration, qui peuvent generer un code
 * TOTP valide ; le reproduire ici n'ajouterait pas de garantie.
 */

test.describe('PWA', () => {
  test('expose un manifeste installable', async ({ page, request }) => {
    await page.goto('/');

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(manifestHref).not.toBeNull();

    const response = await request.get(manifestHref!);
    expect(response.ok()).toBe(true);

    const manifest = (await response.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { sizes: string; purpose?: string }[];
    };

    expect(manifest.name).toContain('FamiliPact');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // Une icone maskable et une icone 512 sont exigees pour l'installation.
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('sert un service worker qui ne met jamais /api en cache', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBe(true);

    const source = await response.text();
    // Garde-fou de revue : la strategie de cache doit rester conservatrice.
    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).toContain('/hors-ligne');

    // Le service worker lui-meme ne doit jamais etre servi depuis un cache.
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('affiche une page hors-ligne sans donnee familiale', async ({ page }) => {
    await page.goto('/hors-ligne');
    await expect(page.getByRole('heading', { name: /connexion indisponible/i })).toBeVisible();
    await expect(page.getByText(/jamais conservees sur l'appareil/i)).toBeVisible();
  });
});

test.describe('en-tetes de securite', () => {
  test('applique une politique de securite du contenu et les en-tetes attendus', async ({
    request,
  }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('geolocation=()');
    // La version du serveur n'est pas annoncee.
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('ne met jamais les reponses API en cache', async ({ request, baseURL }) => {
    const response = await request.post('/api/auth/login', {
      data: { identifier: 'inconnu@example.test', password: 'peu importe' },
      headers: { origin: baseURL! },
      failOnStatusCode: false,
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('acces aux espaces prives', () => {
  test('renvoie un visiteur anonyme vers la connexion', async ({ page }) => {
    await page.goto('/parent');
    await expect(page).toHaveURL(/\/connexion/);

    await page.goto('/enfant');
    await expect(page).toHaveURL(/\/connexion/);

    await page.goto('/parent/points');
    await expect(page).toHaveURL(/\/connexion/);
  });

  test('refuse les appels API sans session', async ({ request }) => {
    const response = await request.post('/api/points/adjust', {
      data: {
        childMembershipId: '00000000-0000-0000-0000-000000000000',
        delta: 100,
        reason: 'test',
      },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(response.status());
  });

  test("refuse une mutation dont l'origine ne correspond pas", async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: { identifier: 'a@example.test', password: 'x' },
      headers: { origin: 'https://attaquant.example' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(403);
  });

  test('protege le declencheur des jobs par un jeton', async ({ request }) => {
    const withoutToken = await request.post('/api/jobs/run', { failOnStatusCode: false });
    expect(withoutToken.status()).toBe(403);

    const withWrongToken = await request.post('/api/jobs/run', {
      headers: { 'x-familipact-job-token': 'mauvais-jeton' },
      failOnStatusCode: false,
    });
    expect(withWrongToken.status()).toBe(403);
  });
});

test.describe('accueil public', () => {
  test("annonce clairement ce que l'application ne fait pas", async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /les regles familiales, simplement/i }),
    ).toBeVisible();
    await expect(page.getByText(/ne bloque aucun telephone/i)).toBeVisible();
    await expect(page.getByText(/ne localise pas les enfants/i)).toBeVisible();
    await expect(page.getByText(/n'applique jamais une sanction toute seule/i)).toBeVisible();
  });

  test("presente de vraies captures de l'application", async ({ page, request }) => {
    await page.goto('/');

    // Les captures sont des fichiers statiques : un renommage casserait la page
    // sans qu'aucun test unitaire ne s'en apercoive. On verifie donc a la fois
    // leur presence dans le DOM et le fait que le serveur les serve vraiment.
    const previews = page.locator('main img[src^="/captures/"]');
    await expect(previews).toHaveCount(4);

    const sources = await previews.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).getAttribute('src') ?? ''),
    );
    for (const source of sources) {
      const response = await request.get(source);
      expect(response.ok(), `${source} doit etre servie`).toBe(true);
      expect(response.headers()['content-type']).toContain('image/webp');
    }

    // Une capture sans description alternative n'apprend rien a qui ne la voit pas.
    for (let index = 0; index < 4; index += 1) {
      await expect(previews.nth(index)).toHaveAttribute('alt', /.{40,}/);
    }
  });

  test("propose un lien d'evitement vers le contenu", async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: /aller au contenu principal/i });
    await expect(skipLink).toBeFocused();
  });
});

test.describe('inscription et invitation', () => {
  test('exige un code valide pour rejoindre une famille', async ({ page }) => {
    await page.goto('/rejoindre');
    await page.getByLabel(/code d'invitation/i).fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
    await page.getByRole('button', { name: /verifier le code/i }).click();

    // Le locator est restreint au contenu : Next ajoute son propre element
    // `role="alert"` (l'annonceur de navigation) en dehors de `<main>`.
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      /invalide|deja ete utilise/i,
    );
  });

  test('annonce la double authentification obligatoire des la creation de compte', async ({
    page,
  }) => {
    await page.goto('/creer-compte');
    await expect(page.getByText(/double authentification/i)).toBeVisible();
    await expect(page.getByText(/obligatoire pour tous les comptes parents/i)).toBeVisible();
  });
});
