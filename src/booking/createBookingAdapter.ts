import type { IBookingAdapter } from './IBookingAdapter';
import { iikoBookingAdapter } from './adapters/iikoBookingAdapter';
import { rkeeperBookingAdapter } from './adapters/rkeeperBookingAdapter';
import { supabaseBookingAdapter } from './adapters/supabaseBookingAdapter';
import { normalizePosSystemName } from '../pos/normalizePosSystemName';

export function createBookingAdapter(posSystemName: string): IBookingAdapter {
  const name = normalizePosSystemName(posSystemName);
  switch (name) {
    case 'iiko':
      return iikoBookingAdapter;
    case 'rkeeper':
      return rkeeperBookingAdapter;
    case 'supabase':
      return supabaseBookingAdapter;
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
