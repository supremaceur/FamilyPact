import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoMark, Wordmark } from '@/components/brand/logo';
import { AppPreview } from '@/components/marketing/app-preview';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { getCurrentSession } from '@/server/auth/context';
import { landingDestinationFor } from '@/server/auth/routing';

/**
 * Accueil public.
 *
 * Un visiteur deja connecte est renvoye vers son espace : reafficher une page
 * de presentation a quelqu'un qui a une session ouverte n'a pas de sens.
 *
 * PARTI PRIS — la page montre l'application plutot qu'elle ne la decrit. Les
 * captures viennent du jeu de demonstration et sont de vraies pages rendues par
 * le produit, pas des maquettes : un parent doit pouvoir juger l'interface
 * avant de creer un compte.
 *
 * Elle dit aussi tres tot ce que FamiliPact ne fait pas. C'est un argument, pas
 * une precaution : un parent qui cherche un controle parental technique doit le
 * comprendre ici, pas apres l'inscription.
 *
 * Aucune couleur nouvelle n'est introduite. La page reutilise les jetons de
 * `globals.css` (`--color-pact-*`, `--surface`, `--text-*`), donc elle suit le
 * theme clair ou sombre du systeme comme le reste de l'application.
 */
const HomePage = async () => {
  const session = await getCurrentSession();
  if (session !== null) redirect(await landingDestinationFor(session));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 pt-6">
        <Wordmark />
        <Link
          href="/connexion"
          className="text-pact-700 dark:text-pact-300 text-sm font-medium underline-offset-4 hover:underline"
        >
          Se connecter
        </Link>
      </header>

      <main id="contenu" className="flex-1">
        <Hero />
        <PrincipleBand />
        <FeatureSections />
        <ScopeSection />
        <FinalCallToAction />
      </main>

      <Footer />
    </div>
  );
};

/* ------------------------------------------------------------------ Hero -- */

const Hero = () => (
  <section className="from-pact-50 dark:from-pact-950/60 bg-linear-to-b to-[var(--surface)] to-75%">
    <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-12 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16 lg:py-20">
      <div className="max-w-xl">
        <LogoMark className="text-pact-600 dark:text-pact-400 size-11" />

        <h1 className="mt-6 text-[2.125rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-5xl">
          Les regles familiales, simplement.
        </h1>

        <p className="mt-5 text-[1.0625rem] leading-relaxed text-[var(--text-secondary)] sm:text-lg">
          Des taches definies ensemble, des points qui progressent, des recompenses et des sanctions
          proposees par l&apos;application — et decidees par vous.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/creer-compte" className="sm:flex-1 lg:max-w-56">
            <Button size="lg" fullWidth>
              Creer ma famille
            </Button>
          </Link>
          <Link href="/connexion" className="sm:flex-1 lg:max-w-56">
            <Button size="lg" variant="secondary" fullWidth>
              Se connecter
            </Button>
          </Link>
        </div>

        <Link
          href="/rejoindre"
          className="text-pact-700 dark:text-pact-300 mt-4 inline-block text-sm font-medium underline underline-offset-4"
        >
          J&apos;ai un code d&apos;invitation
        </Link>

        <p className="mt-8 border-t border-[var(--border-subtle)] pt-6 text-sm leading-relaxed text-[var(--text-muted)]">
          Aucun blocage d&apos;appareil, aucune localisation, aucune lecture de messages. FamiliPact
          n&apos;est pas un outil de surveillance.
        </p>
      </div>

      <AppPreview
        capture="parent-tableau-de-bord"
        alt="Tableau de bord parent : un bandeau « Actions requises » signale une tache a valider et une tache non realisee, puis chaque enfant apparait avec son score et sa progression vers la prochaine recompense."
        eager
        className="w-full max-w-[288px] justify-self-center lg:max-w-[320px]"
      />
    </div>
  </section>
);

/* ------------------------------------------------------ Bande de principe -- */

/**
 * La regle du produit, affichee telle quelle.
 *
 * Les trois premiers verbes disent ce que fait la machine ; le quatrieme dit ce
 * qu'elle ne fera jamais. La difference de traitement visuel n'est pas
 * decorative : c'est le resume de l'application.
 */
const PrincipleBand = () => (
  <section
    aria-labelledby="principe"
    className="border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
  >
    <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:py-16">
      <h2 id="principe" className="sr-only">
        Le principe de FamiliPact
      </h2>

      <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
        <PrincipleCell
          title={<>L&apos;application calcule</>}
          detail="Les points decoulent des taches validees. Personne ne les saisit a la main."
        />
        <PrincipleCell
          title={<>L&apos;application informe</>}
          detail="Une echeance depassee est signalee, avec le retrait qu'elle rendrait possible."
        />
        <PrincipleCell
          title={<>L&apos;application propose</>}
          detail="Un palier atteint ouvre une proposition. Elle attend ; elle ne s'applique pas."
        />
        <PrincipleCell
          title="Le parent decide"
          detail="Rien n'est credite, retire ou active sans une action explicite de votre part."
          emphasis
        />
      </div>
    </div>
  </section>
);

const PrincipleCell = ({
  title,
  detail,
  emphasis = false,
}: {
  readonly title: ReactNode;
  readonly detail: string;
  readonly emphasis?: boolean;
}) => (
  <div
    className={cn(
      'px-5 py-6',
      emphasis
        ? 'bg-pact-600 dark:bg-pact-500 dark:text-sand-950 text-white'
        : 'bg-[var(--surface-raised)]',
    )}
  >
    <p className="text-lg font-semibold tracking-tight">{title}</p>
    <p
      className={cn(
        'mt-2 text-sm leading-relaxed',
        emphasis ? 'opacity-90' : 'text-[var(--text-secondary)]',
      )}
    >
      {detail}
    </p>
  </div>
);

/* ------------------------------------------------------- Sections produit -- */

const FeatureSections = () => (
  <div className="mx-auto w-full max-w-6xl px-5">
    <Feature
      eyebrow="Validations"
      title="Rien ne s'applique tout seul"
      capture="parent-validations"
      alt="Ecran des validations : une tache declaree terminee propose « Valider +20 » ou « Refuser » ; une echeance depassee propose « Confirmer −10 » ou « Ignorer », avec la mention qu'aucun point n'a ete retire."
      points={[
        "Une tache declaree terminee attend votre validation. Le bouton affiche le gain exact avant que vous ne l'accordiez.",
        'Une echeance depassee ne retire jamais de points : elle ouvre une decision, que vous pouvez ignorer.',
        "Valider ne credite les points qu'une seule fois, meme si les deux parents cliquent au meme instant.",
      ]}
    />
    <Feature
      eyebrow="Cote enfant"
      title="Une progression lisible, pas un jeu"
      capture="enfant-tableau-de-bord"
      alt="Tableau de bord enfant : le score « 375 points », la progression vers la prochaine recompense, la tache du jour avec le bouton « J'ai termine », et les taches en attente de validation d'un parent."
      reversed
      points={[
        "L'enfant voit son score, ce qu'il reste avant le prochain palier, et ce qui est attendu aujourd'hui.",
        "Le bouton « J'ai termine » declare une tache ; il ne credite rien. Les points arrivent apres validation.",
        'Ni badges, ni niveaux, ni series, ni classement entre enfants. Les points reperent une progression, ils ne sont pas une monnaie.',
      ]}
    />
    <Feature
      eyebrow="Sanctions"
      title="Une sanction reste une decision humaine"
      capture="parent-sanctions"
      alt="Ecran des sanctions : un bandeau rappelle que FamiliPact n'applique aucune sanction, suivi des sanctions proposees puis d'une sanction en cours avec sa condition de levee et le bouton « Lever la sanction »."
      points={[
        "Un seuil franchi affiche une proposition. Tant que vous ne l'activez pas, il ne se passe rien.",
        "Une condition de levee atteinte n'eteint pas la sanction : elle vous ouvre la possibilite de la lever.",
        "La mise en oeuvre vous appartient : l'application enregistre et rappelle, elle n'agit sur aucun appareil.",
      ]}
    />
  </div>
);

const Feature = ({
  eyebrow,
  title,
  points,
  capture,
  alt,
  reversed = false,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly points: readonly string[];
  readonly capture: string;
  readonly alt: string;
  /** Alterne le cote de la capture sur grand ecran, pour rythmer la lecture. */
  readonly reversed?: boolean;
}) => (
  <section className="grid gap-10 border-b border-[var(--border-subtle)] py-14 last:border-b-0 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
    <div className={reversed ? 'lg:order-2' : undefined}>
      <p className="text-pact-700 dark:text-pact-300 text-xs font-semibold tracking-[0.08em] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
      <ul className="mt-6 space-y-4">
        {points.map((point) => (
          <li key={point} className="flex gap-3">
            <CheckIcon />
            <span className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
              {point}
            </span>
          </li>
        ))}
      </ul>
    </div>

    <AppPreview
      capture={capture}
      alt={alt}
      className={cn(
        'w-full max-w-[288px] justify-self-center lg:max-w-[300px]',
        reversed && 'lg:order-1',
      )}
    />
  </section>
);

/* -------------------------------------------------------------- Perimetre -- */

const ScopeSection = () => (
  <section
    aria-labelledby="perimetre"
    className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
  >
    <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:py-20">
      <h2 id="perimetre" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Ce que FamiliPact fait — et ne fait pas
      </h2>
      <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
        Le perimetre est volontairement etroit. FamiliPact tient le cadre que vous avez pose ; il ne
        prend pas votre place et ne surveille personne.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <ScopeCard
          title="Ce que l'application fait"
          tone="positive"
          items={[
            'Elle calcule les points a partir des taches validees.',
            'Elle signale les echeances depassees.',
            'Elle propose une recompense quand un palier est atteint.',
            'Elle garde une trace complete et immuable de chaque decision.',
          ]}
        />
        <ScopeCard
          title="Ce qu'elle ne fait pas"
          tone="negative"
          items={[
            'Elle ne bloque aucun telephone ni aucune application.',
            'Elle ne localise pas les enfants et ne lit aucun message.',
            "Elle n'applique jamais une sanction toute seule.",
            "Elle n'accorde jamais une recompense sans votre accord.",
          ]}
        />
      </div>
    </div>
  </section>
);

const ScopeCard = ({
  title,
  items,
  tone,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone: 'positive' | 'negative';
}) => (
  <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-soft)]">
    <h3 className="text-base font-semibold">{title}</h3>
    <ul className="mt-4 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          {tone === 'positive' ? <CheckIcon /> : <CrossIcon />}
          <span className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            {item}
          </span>
        </li>
      ))}
    </ul>
  </div>
);

/* ------------------------------------------------------------ Appel final -- */

const FinalCallToAction = () => (
  <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
    <div className="from-pact-700 to-pact-900 dark:from-pact-800 dark:to-pact-950 mx-auto max-w-3xl rounded-[var(--radius-card)] bg-linear-to-br px-6 py-12 text-center text-white sm:px-12">
      <LogoMark className="text-pact-200 mx-auto size-10" />
      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        Posez le cadre une fois. L&apos;application s&apos;occupe du calcul.
      </h2>
      <p className="text-pact-100 mx-auto mt-4 max-w-xl text-[0.9375rem] leading-relaxed">
        Creez votre famille, invitez l&apos;autre parent, ajoutez vos enfants. La configuration
        prend quelques minutes et reste modifiable a tout moment.
      </p>
      <div className="mx-auto mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
        <Link href="/creer-compte" className="sm:flex-1">
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            className="text-pact-800 border-transparent bg-white hover:bg-white/90"
          >
            Creer ma famille
          </Button>
        </Link>
        <Link href="/rejoindre" className="sm:flex-1">
          <Button
            size="lg"
            variant="ghost"
            fullWidth
            className="border border-white/40 whitespace-nowrap text-white hover:bg-white/10"
          >
            J&apos;ai un code d&apos;invitation
          </Button>
        </Link>
      </div>
    </div>
  </section>
);

/* -------------------------------------------------------------------- Pied -- */

const Footer = () => (
  <footer className="border-t border-[var(--border-subtle)]">
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
      <Wordmark />
      <p className="max-w-md text-xs leading-relaxed text-[var(--text-muted)]">
        Les captures presentent une famille de demonstration : prenoms, taches et scores sont
        fictifs. Les ecrans, eux, sont ceux de l&apos;application, sans retouche.
      </p>
    </div>
  </footer>
);

/* ------------------------------------------------------------------ Icones -- */

const IconFrame = ({ children }: { readonly children: ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    className="mt-0.5 size-5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const CheckIcon = () => (
  <span className="text-leaf-600 dark:text-leaf-200">
    <IconFrame>
      <circle cx="10" cy="10" r="8" strokeOpacity="0.35" />
      <path d="m6.5 10.25 2.3 2.3 4.7-4.8" />
    </IconFrame>
  </span>
);

const CrossIcon = () => (
  <span className="text-clay-600 dark:text-clay-200">
    <IconFrame>
      <circle cx="10" cy="10" r="8" strokeOpacity="0.35" />
      <path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6" />
    </IconFrame>
  </span>
);

export default HomePage;
