import type { IPosAdapter } from './posAdapter';
import { normalizePosSystemName } from './normalizePosSystemName';
import { iikoAdapter } from './adapters/iikoAdapter';
import { rkeeperAdapter } from './adapters/rkeeperAdapter';
import { supabaseAdapter } from './adapters/supabaseAdapter';

/**
 * Factory: pick POS implementation by name. Aliases: `r-keeper`, `r_keeper`, `internal` → supabase.
 */
export function createPosAdapter(posSystemName: string): IPosAdapter {
  const name = normalizePosSystemName(posSystemName);
  switch (name) {
    case 'iiko':
      return iikoAdapter;
    case 'rkeeper':
      return rkeeperAdapter;
    case 'supabase':
      return supabaseAdapter;
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
