/**
 * Formatage localise.
 *
 * Les dates sont TOUJOURS formatees dans le fuseau de la famille, jamais dans
 * celui du serveur ni du navigateur : deux parents dans deux pays doivent lire
 * exactement le meme horaire pour une meme echeance.
 */

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const formatter = (
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  key: string,
): Intl.DateTimeFormat => {
  const cacheKey = `${timeZone}:${key}`;
  const cached = dateTimeFormatters.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('fr-FR', { timeZone, ...options });
  dateTimeFormatters.set(cacheKey, created);
  return created;
};

export const formatDateTime = (instant: Date, timeZone: string): string =>
  formatter(timeZone, { dateStyle: 'short', timeStyle: 'short' }, 'dateTime').format(instant);

export const formatLongDateTime = (instant: Date, timeZone: string): string =>
  formatter(timeZone, { dateStyle: 'full', timeStyle: 'short' }, 'longDateTime').format(instant);

export const formatDate = (instant: Date, timeZone: string): string =>
  formatter(timeZone, { dateStyle: 'medium' }, 'date').format(instant);

export const formatTime = (instant: Date, timeZone: string): string =>
  formatter(timeZone, { timeStyle: 'short' }, 'time').format(instant);

export const formatWeekdayDate = (instant: Date, timeZone: string): string =>
  formatter(timeZone, { weekday: 'long', day: 'numeric', month: 'long' }, 'weekday').format(
    instant,
  );

/** « +20 » / « -10 » : le signe est toujours explicite pour un mouvement de points. */
export const formatDelta = (delta: number): string =>
  `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`;

export const formatPoints = (value: number): string =>
  `${value} ${Math.abs(value) > 1 ? 'points' : 'point'}`;

/**
 * Duree restante en langage naturel, arrondie a l'unite la plus parlante.
 * Une echeance depassee est signalee explicitement plutot que rendue negative.
 */
export const formatRelativeDeadline = (target: Date, now: Date = new Date()): string => {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'echeance depassee';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `dans ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return days === 1 ? 'demain' : `dans ${days} jours`;
  const months = Math.round(days / 30);
  return months === 1 ? 'dans 1 mois' : `dans ${months} mois`;
};
