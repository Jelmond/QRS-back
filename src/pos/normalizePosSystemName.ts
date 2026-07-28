import type { PosSystemName } from './types';

const ALIASES: Record<string, PosSystemName> = {
  iiko: 'iiko',
  rkeeper: 'rkeeper',
  'r-keeper': 'rkeeper',
  r_keeper: 'rkeeper',
  rk: 'rkeeper',
  supabase: 'supabase',
  internal: 'supabase',
};

export function normalizePosSystemName(raw: string): PosSystemName {
  const key = raw.trim().toLowerCase();
  const resolved = ALIASES[key];
  if (!resolved) {
    throw new Error(
      `Unknown posSystemName "${raw}". Expected one of: ${Object.keys(ALIASES).join(', ')}`
    );
  }
  return resolved;
}
