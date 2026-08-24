/**
 * Capture les visuels de la page d'accueil depuis l'application REELLE.
 *
 * Ces images ne sont pas des maquettes : ce sont les ecrans que voit un
 * utilisateur, rendus par le vrai code, avec les vraies donnees de la famille
 * de demonstration creee par `npm run db:seed`. Une maquette dessinee a la main
 * derive du produit au premier changement d'interface ; une capture, non.
 *
 * La session est ouverte en INSERANT directement une ligne `Session`, plutot
 * qu'en pilotant le formulaire de connexion. Traverser le TOTP dans un
 * navigateur automatise rendrait le script fragile pour zero gain : ce qui nous
 * interesse ici, c'est le rendu des ecrans, pas le parcours d'authentification
 * (deja couvert par les tests d'integration).
 *
 * Usage :
 *   npm run build && npm run start -- --port 3200 &
 *   npx tsx --conditions=react-server scripts/capture-screenshots.ts
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { chromium, devices } from '@playwright/test';
import sharp from 'sharp';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { SessionStatus } from '../src/generated/prisma/enums';
import { hashLookupToken } from '../src/server/crypto/hashing';

const BASE_URL = process.env['CAPTURE_BASE_URL'] ?? 'http://127.0.0.1:3200';
const SORTIE = path.join(process.cwd(), 'public', 'captures');
const CHROMIUM_PREINSTALLE = '/opt/pw-browsers/chromium';

interface Ecran {
  readonly fichier: string;
  readonly chemin: string;
  readonly acteur: 'parent' | 'enfant';
  /** Hauteur de capture : certains ecrans meritent d'etre montres en entier. */
  readonly hauteur: number;
}

/**
 * Les deux themes sont captures. La page d'accueil sert ensuite l'un ou l'autre
 * via `<picture media="(prefers-color-scheme: dark)">` : le navigateur ne
 * telecharge que celui dont il a besoin, et une capture claire ne vient jamais
 * trouer une page sombre.
 */
const THEMES = ['light', 'dark'] as const;

const ECRANS: readonly Ecran[] = [
  { fichier: 'parent-tableau-de-bord', chemin: '/parent', acteur: 'parent', hauteur: 1180 },
  { fichier: 'parent-validations', chemin: '/parent/validations', acteur: 'parent', hauteur: 900 },
  { fichier: 'parent-sanctions', chemin: '/parent/sanctions', acteur: 'parent', hauteur: 980 },
  { fichier: 'enfant-tableau-de-bord', chemin: '/enfant', acteur: 'enfant', hauteur: 1100 },
];

/** Ouvre une session valide et rend le jeton a poser dans le cookie. */
const ouvrirSession = async (
  prisma: PrismaClient,
  email: string | null,
  loginId: string | null,
) => {
  const utilisateur = await prisma.user.findFirstOrThrow({
    where: email !== null ? { email } : { loginId: loginId! },
    select: { id: true, displayName: true },
  });

  const jeton = randomUUID() + randomUUID();
  await prisma.session.create({
    data: {
      userId: utilisateur.id,
      tokenHash: hashLookupToken(jeton),
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      idleExpiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { jeton, nom: utilisateur.displayName };
};

const main = async (): Promise<void> => {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL est obligatoire.');

  // On repart d'un dossier propre : une capture d'un ecran supprime ne doit pas
  // survivre indefiniment dans `public/`.
  await rm(SORTIE, { recursive: true, force: true });
  await mkdir(SORTIE, { recursive: true });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const navigateur = await chromium.launch(
    existsSync(CHROMIUM_PREINSTALLE) ? { executablePath: CHROMIUM_PREINSTALLE } : {},
  );

  try {
    const parent = await ouvrirSession(prisma, 'marie@demo.familipact.test', null);
    const enfant = await ouvrirSession(prisma, null, 'lucas.demo');

    for (const ecran of ECRANS) {
      for (const theme of THEMES) {
        const session = ecran.acteur === 'parent' ? parent : enfant;

        const contexte = await navigateur.newContext({
          ...devices['Pixel 7'],
          viewport: { width: 412, height: ecran.hauteur },
          // Rendu net sur ecran haute densite, sans peser trois fois plus lourd.
          deviceScaleFactor: 2,
          locale: 'fr-FR',
          timezoneId: 'Europe/Paris',
          colorScheme: theme,
        });

        // En developpement le cookie n'a pas le prefixe `__Host-` (voir
        // src/server/auth/session.ts) : il est donc pose sous son nom simple.
        await contexte.addCookies([
          {
            name: 'familipact_session',
            value: session.jeton,
            url: BASE_URL,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);

        const page = await contexte.newPage();
        await page.goto(`${BASE_URL}${ecran.chemin}`, { waitUntil: 'networkidle' });

        // La barre de navigation basse est utile dans l'application, mais elle
        // flotte au-dessus du contenu et parasite une capture destinee a montrer
        // un ecran. On la retire, ainsi que le lien d'evitement.
        await page.addStyleTag({
          content: `
          nav[aria-label="Navigation principale"] { display: none !important; }
          .skip-link { display: none !important; }
          main { padding-bottom: 1.5rem !important; }
        `,
        });
        await page.waitForTimeout(400);

        const tampon = await page.screenshot({ type: 'png' });

        // WebP sans perte : le texte d'une capture d'ecran ne supporte pas la
        // compression avec perte, mais WebP reste bien plus leger qu'un PNG.
        const destination = path.join(SORTIE, `${ecran.fichier}-${theme}.webp`);
        const { size } = await sharp(tampon)
          .webp({ lossless: true, effort: 6 })
          .toFile(destination);
        console.log(
          `  ${ecran.fichier}-${theme}.webp  ${(size / 1024).toFixed(0)} Ko  (${ecran.chemin}, ${session.nom})`,
        );

        await contexte.close();
      }
    }

    // Les sessions de capture n'ont plus lieu d'etre.
    await prisma.session.deleteMany({
      where: { tokenHash: { in: [parent.jeton, enfant.jeton].map(hashLookupToken) } },
    });
  } finally {
    await navigateur.close();
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
