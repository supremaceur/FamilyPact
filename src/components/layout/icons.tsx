/**
 * Pictogrammes de navigation.
 *
 * Traces a la main plutot qu'importes d'une bibliotheque : une dizaine
 * d'icones ne justifie pas une dependance, et un SVG inline reste compatible
 * avec une CSP stricte sans requete supplementaire.
 *
 * Tous sont `aria-hidden` : le libelle textuel est toujours present a cote.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const HomeIcon = () => (
  <svg {...base} className="size-5">
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const ChildrenIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="9" cy="8" r="3.2" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M3 20a6 6 0 0 1 12 0M15.5 20a5 5 0 0 1 5.5-4.9" />
  </svg>
);

export const TaskIcon = () => (
  <svg {...base} className="size-5">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5L16 9.5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} className="size-5">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const RewardIcon = () => (
  <svg {...base} className="size-5">
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8v12M4 12h16M6 8a3 3 0 0 1 6 0M18 8a3 3 0 0 0-6 0" />
  </svg>
);

export const SanctionIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

export const PointsIcon = () => (
  <svg {...base} className="size-5">
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
  </svg>
);

export const RulesIcon = () => (
  <svg {...base} className="size-5">
    <path d="M4 5h16M4 12h16M4 19h10" />
  </svg>
);

export const MembersIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
  </svg>
);

export const HistoryIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const ShieldIcon = () => (
  <svg {...base} className="size-5">
    <path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6Z" />
  </svg>
);

export const ProfileIcon = () => (
  <svg {...base} className="size-5">
    <circle cx="12" cy="9" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </svg>
);

export const InviteIcon = () => (
  <svg {...base} className="size-5">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);
