import 'server-only';

/**
 * Lecture defensive des corps de requete JSON.
 *
 * Un corps venant du reseau est de type `unknown` : le convertir avec `String()`
 * transformerait un objet en « [object Object] » et laisserait passer une
 * valeur absurde jusqu'a la validation Zod. Ces helpers rendent la valeur
 * uniquement quand elle a bien le type attendu, et une chaine vide sinon —
 * la validation Zod du service produira alors le bon message d'erreur.
 */

export const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const readOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Corps JSON tolerant : un corps absent ou illisible devient un objet vide. */
export const readJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
