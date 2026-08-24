import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Fusionne des classes Tailwind en resolvant les conflits.
 * Une classe passee en argument ecrase toujours celle par defaut du composant.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
