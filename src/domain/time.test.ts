import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  compareLocalDates,
  endOfLocalDay,
  isoWeekday,
  isValidTimeZone,
  localDateTimeToInstant,
  localDaysBetween,
  toLocalDate,
  toLocalTime,
} from './time';

const PARIS = 'Europe/Paris';

describe('toLocalDate', () => {
  it('rend la date locale de la famille, pas celle du serveur', () => {
    // 2026-08-24T22:30:00Z = 2026-08-25 00:30 a Paris (UTC+2 en ete).
    expect(toLocalDate(new Date('2026-08-24T22:30:00Z'), PARIS)).toBe('2026-08-25');
    expect(toLocalDate(new Date('2026-08-24T22:30:00Z'), 'UTC')).toBe('2026-08-24');
    expect(toLocalDate(new Date('2026-08-24T22:30:00Z'), 'America/New_York')).toBe('2026-08-24');
  });

  it("rend l'heure locale", () => {
    expect(toLocalTime(new Date('2026-08-24T16:05:00Z'), PARIS)).toBe('18:05');
  });
});

describe('localDateTimeToInstant', () => {
  it("applique le decalage d'ete", () => {
    expect(localDateTimeToInstant('2026-08-24', '18:00', PARIS).toISOString()).toBe(
      '2026-08-24T16:00:00.000Z',
    );
  });

  it("applique le decalage d'hiver", () => {
    expect(localDateTimeToInstant('2026-01-15', '18:00', PARIS).toISOString()).toBe(
      '2026-01-15T17:00:00.000Z',
    );
  });

  it("gere le passage a l'heure d'ete (nuit du dernier dimanche de mars)", () => {
    // A Paris, le 29 mars 2026 a 02:00 locales, l'horloge saute a 03:00.
    // 01:30 existe encore en heure d'hiver (UTC+1).
    expect(localDateTimeToInstant('2026-03-29', '01:30', PARIS).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    // 04:00 est deja en heure d'ete (UTC+2).
    expect(localDateTimeToInstant('2026-03-29', '04:00', PARIS).toISOString()).toBe(
      '2026-03-29T02:00:00.000Z',
    );
  });

  it('gere une heure locale inexistante en la reportant apres la transition', () => {
    // 02:30 n'existe pas le 29 mars 2026 a Paris.
    const instant = localDateTimeToInstant('2026-03-29', '02:30', PARIS);
    expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // L'instant retenu correspond bien a 03:30 locales, soit apres le saut.
    expect(toLocalTime(instant, PARIS)).toBe('03:30');
  });

  it("gere le passage a l'heure d'hiver (heure ambigue)", () => {
    // Le 25 octobre 2026, 02:30 locales existe deux fois a Paris.
    // On retient la premiere occurrence, encore en heure d'ete (UTC+2).
    const instant = localDateTimeToInstant('2026-10-25', '02:30', PARIS);
    expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(toLocalTime(instant, PARIS)).toBe('02:30');
  });

  it('est stable pour les fuseaux a decalage non entier', () => {
    expect(localDateTimeToInstant('2026-08-24', '12:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-08-24T06:30:00.000Z',
    );
  });
});

describe('endOfLocalDay', () => {
  it('rend la derniere milliseconde de la journee locale', () => {
    expect(endOfLocalDay('2026-08-24', PARIS).toISOString()).toBe('2026-08-24T21:59:59.999Z');
  });
});

describe('helpers de dates locales', () => {
  it('ajoute des jours sans passer par un fuseau', () => {
    expect(addLocalDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2028-03-01', -1)).toBe('2028-02-29');
    // La journee de bascule d'heure reste une journee entiere.
    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29');
  });

  it('rend le jour ISO de la semaine', () => {
    expect(isoWeekday('2026-08-24')).toBe(1); // lundi
    expect(isoWeekday('2026-08-30')).toBe(7); // dimanche
  });

  it('compare et soustrait des dates locales', () => {
    expect(compareLocalDates('2026-08-24', '2026-08-25')).toBe(-1);
    expect(compareLocalDates('2026-08-25', '2026-08-25')).toBe(0);
    expect(localDaysBetween('2026-08-24', '2026-09-01')).toBe(8);
    // Une bascule d'heure ne fait pas perdre ni gagner un jour.
    expect(localDaysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('valide les fuseaux', () => {
    expect(isValidTimeZone(PARIS)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
