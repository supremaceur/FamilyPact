/**
 * Manipulation des dates dans le fuseau de la famille.
 *
 * Regles suivies partout dans l'application :
 *   - un INSTANT (echeance, horodatage) est stocke en UTC ;
 *   - une DATE LOCALE (jour d'une occurrence) est stockee en texte "YYYY-MM-DD"
 *     et n'a de sens que rapportee au fuseau IANA de la famille ;
 *   - la logique de recurrence ne depend jamais du fuseau du serveur.
 *
 * L'implementation s'appuie sur `Intl.DateTimeFormat`, disponible partout, plutot
 * que sur une dependance de manipulation de dates : le besoin se limite a la
 * conversion instant <-> date locale, et les transitions d'heure d'ete sont
 * couvertes par des tests dedies.
 */

/** Date locale au format ISO court, ex. "2026-08-24". */
export type LocalDate = string;

/** Heure locale au format "HH:mm", ex. "18:30". */
export type LocalTime = string;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Volontairement de simples predicats booleens, sans garde de type : `LocalDate`
// est un alias de `string`, un predicat reduirait la branche negative a `never`
// et empecherait d'inclure la valeur fautive dans le message d'erreur.
export const isLocalDate = (value: string): boolean => LOCAL_DATE_PATTERN.test(value);
export const isLocalTime = (value: string): boolean => LOCAL_TIME_PATTERN.test(value);

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const partsFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
};

/** Decompose un instant dans le fuseau demande. */
export const getZonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Composant de date manquant: ${type}`);
    return Number.parseInt(part.value, 10);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `hourCycle: 'h23'` garantit 0-23, mais certains runtimes rendent "24" a minuit.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
};

/** Decalage du fuseau, en millisecondes, a l'instant donne. */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = getZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Le formateur ne restitue pas les millisecondes : on compare a la seconde.
  const instantAtSecondPrecision = instant.getTime() - instant.getUTCMilliseconds();
  return asIfUtc - instantAtSecondPrecision;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Instant -> date locale "YYYY-MM-DD" dans le fuseau demande. */
export const toLocalDate = (instant: Date, timeZone: string): LocalDate => {
  const { year, month, day } = getZonedParts(instant, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

/** Instant -> heure locale "HH:mm" dans le fuseau demande. */
export const toLocalTime = (instant: Date, timeZone: string): LocalTime => {
  const { hour, minute } = getZonedParts(instant, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
};

/**
 * Date + heure locales -> instant absolu.
 *
 * Les changements d'heure creent deux cas particuliers, resolus ici selon la
 * meme convention que la proposition Temporal (`disambiguation: "compatible"`) :
 *
 *   - HEURE AMBIGUE (bascule d'automne : 02:30 existe deux fois)
 *     -> la PREMIERE occurrence est retenue, c'est-a-dire encore en heure d'ete.
 *
 *   - HEURE INEXISTANTE (bascule de printemps : 02:30 n'existe pas)
 *     -> l'heure locale est decalee vers l'avant de la duree du saut,
 *        02:30 devient donc 03:30 locales.
 *
 * L'algorithme encadre l'instant naif par les decalages en vigueur 24 h avant et
 * 24 h apres, puis verifie laquelle des deux hypotheses se re-projette bien sur
 * l'heure locale demandee. Aucun fuseau reel n'operant deux transitions en 48 h,
 * cet encadrement est suffisant.
 */
export const localDateTimeToInstant = (
  date: LocalDate,
  time: LocalTime,
  timeZone: string,
): Date => {
  if (!isLocalDate(date)) throw new Error(`Date locale invalide: ${date}`);
  if (!isLocalTime(time)) throw new Error(`Heure locale invalide: ${time}`);

  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
  ];

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const dayMs = 86_400_000;

  const offsetBefore = zoneOffsetMs(new Date(naiveUtc - dayMs), timeZone);
  const offsetAfter = zoneOffsetMs(new Date(naiveUtc + dayMs), timeZone);

  // Cas courant : aucune transition dans la fenetre.
  if (offsetBefore === offsetAfter) return new Date(naiveUtc - offsetBefore);

  const earlier = naiveUtc - offsetBefore;
  const later = naiveUtc - offsetAfter;

  const earlierIsValid = zoneOffsetMs(new Date(earlier), timeZone) === offsetBefore;
  const laterIsValid = zoneOffsetMs(new Date(later), timeZone) === offsetAfter;

  // Heure ambigue : les deux hypotheses sont valides, on garde la premiere.
  if (earlierIsValid) return new Date(earlier);
  if (laterIsValid) return new Date(later);

  // Heure inexistante : `offsetBefore` projette l'instant juste apres le saut,
  // ce qui revient a decaler l'heure locale de la duree du saut.
  return new Date(earlier);
};

/** Fin de journee locale (23:59:59.999) exprimee en instant absolu. */
export const endOfLocalDay = (date: LocalDate, timeZone: string): Date =>
  new Date(localDateTimeToInstant(date, '23:59', timeZone).getTime() + 59_999);

/** Ajoute des jours a une date locale, sans jamais passer par un fuseau. */
export const addLocalDays = (date: LocalDate, days: number): LocalDate => {
  if (!isLocalDate(date)) throw new Error(`Date locale invalide: ${date}`);
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export const isoWeekday = (date: LocalDate): number => {
  if (!isLocalDate(date)) throw new Error(`Date locale invalide: ${date}`);
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

/** Comparaison lexicographique, valide car le format est zero-padde. */
export const compareLocalDates = (left: LocalDate, right: LocalDate): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Nombre de jours entiers separant deux dates locales (right - left). */
export const localDaysBetween = (left: LocalDate, right: LocalDate): number => {
  const toUtc = (value: LocalDate): number => {
    const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10)) as [
      number,
      number,
      number,
    ];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(right) - toUtc(left)) / 86_400_000);
};
