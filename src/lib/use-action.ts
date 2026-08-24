'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from './api-client';

export interface ActionState {
  readonly pending: boolean;
  readonly error: string | null;
  readonly fieldErrors: Record<string, string[]>;
  readonly notice: string | null;
}

/**
 * Execution d'une mutation, avec les protections anti-erreur exigees par le
 * produit :
 *   - un appel deja en cours bloque les suivants (anti double-clic) ;
 *   - l'erreur est presentee telle que le serveur l'a formulee ;
 *   - `router.refresh()` recharge les donnees du serveur apres succes, plutot
 *     que de deviner le nouvel etat cote client.
 *
 * Aucune mise a jour optimiste sur les points, les sanctions ou les
 * recompenses : afficher un score qui pourrait etre faux serait pire que
 * d'attendre une demi-seconde.
 */
export const useAction = () => {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({
    pending: false,
    error: null,
    fieldErrors: {},
    notice: null,
  });
  const [isRefreshing, startTransition] = useTransition();
  const inFlight = useRef(false);

  const run = useCallback(
    async <T>(
      operation: () => Promise<T>,
      options: {
        readonly onSuccess?: (result: T) => void;
        readonly refresh?: boolean;
        readonly successNotice?: string;
      } = {},
    ): Promise<T | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setState({ pending: true, error: null, fieldErrors: {}, notice: null });

      try {
        const result = await operation();
        setState({
          pending: false,
          error: null,
          fieldErrors: {},
          notice: options.successNotice ?? null,
        });
        options.onSuccess?.(result);
        if (options.refresh !== false) {
          startTransition(() => {
            router.refresh();
          });
        }
        return result;
      } catch (error) {
        if (error instanceof ApiError) {
          setState({
            pending: false,
            error: error.failure.message,
            fieldErrors: error.failure.fieldErrors ?? {},
            notice: null,
          });
        } else {
          setState({
            pending: false,
            error: 'Une erreur est survenue. Reessayez dans un instant.',
            fieldErrors: {},
            notice: null,
          });
        }
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [router],
  );

  const reset = useCallback(() => {
    setState({ pending: false, error: null, fieldErrors: {}, notice: null });
  }, []);

  return { ...state, pending: state.pending || isRefreshing, run, reset };
};
