/**
 * iiko Cloud REST client — auth, token cache, shared HTTP helper, nomenclature.
 * Docs: https://api-ru.iiko.services/docs
 */

import type { PosProduct } from '../types';

const DEFAULT_BASE = 'https://api-ru.iiko.services';

interface TokenResponse {
  token?: string;
  accessToken?: string;
}

export interface IikoSize {
  id: string;
  name?: string;
  price?: number;
  isDefault?: boolean;
}

export interface IikoProduct {
  id: string;
  name?: string;
  /** 'Dish' | 'Goods' | 'Service' | 'Modifier' */
  type?: string;
  isDeleted?: boolean;
  parentGroup?: string;
  sizes?: IikoSize[];
  imageLinks?: string[];
  description?: string;
  additionalInfo?: string;
  portionWeightGrams?: number;
  energyAmount?: number;
  proteins?: number;
  fatAmount?: number;
  carbohydrateAmount?: number;
}

export interface IikoGroup {
  id: string;
  name: string;
  isDeleted?: boolean;
  parentGroup?: string;
}

export interface NomenclatureResponse {
  products?: IikoProduct[];
  groups?: IikoGroup[];
  correlationId?: string;
}

// Per-login token cache: apiLogin → { token, expiresAtMs }
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

function getBaseUrl(): string {
  return (process.env.IIKO_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/**
 * Returns a valid bearer token for the given apiLogin.
 * Falls back to IIKO_API_LOGIN env var when apiLogin is omitted (single-restaurant setups).
 */
export async function getIikoBearerToken(apiLogin?: string): Promise<string> {
  const login = apiLogin || process.env.IIKO_API_LOGIN || '';
  if (!login) throw new Error('IIKO_API_LOGIN is not set');

  const now = Date.now();
  const cached = tokenCache.get(login);
  if (cached && now < cached.expiresAtMs - 60_000) {
    return cached.token;
  }

  const res = await fetch(`${getBaseUrl()}/api/1/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiLogin: login }),
  });

  const body = (await res.json()) as TokenResponse & { message?: string };
  if (!res.ok) {
    throw new Error(`iiko token error ${res.status}: ${body.message || JSON.stringify(body)}`);
  }

  const token = body.token || body.accessToken;
  if (!token) throw new Error('iiko token response missing token field');

  tokenCache.set(login, { token, expiresAtMs: now + 55 * 60 * 1000 });
  return token;
}

/**
 * Authenticated POST to the iiko Cloud API.
 * Accepts an optional apiLogin for per-restaurant token resolution.
 */
export async function iikoPost<T = unknown>(
  path: string,
  body: unknown,
  apiLogin?: string
): Promise<T> {
  const token = await getIikoBearerToken(apiLogin);
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error(`iiko API error ${res.status}: ${path}`);
    return {} as T;
  }

  if (!res.ok) {
    const d = data as Record<string, unknown>;
    const msg = (d?.errorDescription as string) || (d?.message as string) || JSON.stringify(data);
    throw new Error(`iiko API ${path} error ${res.status}: ${msg}`);
  }

  return data as T;
}

// ── Setup / discovery ────────────────────────────────────────────────────────

export interface IikoOrganization {
  id: string;
  name: string;
  isDisabled?: boolean;
}

export interface IikoTerminalGroup {
  id: string;
  name: string;
  organizationId: string;
  isAlive?: boolean;
}

export interface IikoStopListItem {
  productId: string;
  /** -1 means fully stopped (no balance tracked). */
  balance: number;
}

/** List all organizations available for this api login. */
export async function fetchIikoOrganizations(apiLogin?: string): Promise<IikoOrganization[]> {
  const data = await iikoPost<{ organizations?: IikoOrganization[] }>(
    '/api/1/organizations',
    { returnAdditionalInfo: false, includeDisabled: false },
    apiLogin
  );
  return data.organizations ?? [];
}

/** List terminal groups for the given organization IDs. */
export async function fetchIikoTerminalGroups(
  organizationIds: string[],
  apiLogin?: string
): Promise<IikoTerminalGroup[]> {
  const data = await iikoPost<{ terminalGroups?: IikoTerminalGroup[] }>(
    '/api/1/terminal_groups',
    { organizationIds },
    apiLogin
  );
  return data.terminalGroups ?? [];
}

/**
 * Fetch the stop list for a terminal group.
 * Returns product IDs that are currently unavailable (sold out or explicitly stopped).
 */
export async function fetchIikoStopList(
  organizationId: string,
  terminalGroupId: string,
  apiLogin?: string
): Promise<IikoStopListItem[]> {
  const data = await iikoPost<{
    terminalGroupStopLists?: Array<{
      terminalGroupId: string;
      items?: IikoStopListItem[];
    }>;
  }>(
    '/api/1/stop_lists',
    { organizationIds: [organizationId] },
    apiLogin
  );

  for (const group of data.terminalGroupStopLists ?? []) {
    if (group.terminalGroupId === terminalGroupId) {
      return group.items ?? [];
    }
  }
  return [];
}

// ── Nomenclature ─────────────────────────────────────────────────────────────

export async function fetchIikoNomenclature(
  organizationId: string,
  apiLogin?: string
): Promise<NomenclatureResponse> {
  return iikoPost<NomenclatureResponse>(
    '/api/1/nomenclature',
    { organizationId, startRevision: 0, includeDeleted: false },
    apiLogin
  );
}

// ── External menu (v2) ────────────────────────────────────────────────────────

export interface IikoExternalMenuSummary {
  id: string;
  name: string;
}

export interface IikoExternalMenuItem {
  sku: string;
  name: string;
  description?: string;
  itemId: string;
  type?: string;
  isHidden?: boolean;
  itemSizes: Array<{
    sku: string;
    sizeId: string | null;
    sizeName?: string;
    isDefault?: boolean;
    portionWeightGrams?: number;
    isHidden?: boolean;
    prices: Array<{ organizationId: string; price: number }>;
    nutritionPerHundredGrams?: {
      fats?: number;
      proteins?: number;
      carbs?: number;
      energy?: number;
    };
    buttonImageUrl?: string | null;
  }>;
  productCategoryId?: string;
}

export interface IikoExternalMenuCategory {
  id: string;
  name: string;
  description?: string;
  iikoGroupId?: string;
  buttonImageUrl?: string | null;
  headerImageUrl?: string | null;
  items: IikoExternalMenuItem[];
}

export interface IikoExternalMenu {
  id: string;
  name: string;
  description?: string;
  itemCategories: IikoExternalMenuCategory[];
}

/** List external menus available for the given organizations. */
export async function fetchIikoExternalMenus(
  organizationIds: string[],
  apiLogin?: string
): Promise<IikoExternalMenuSummary[]> {
  const data = await iikoPost<{ externalMenus?: IikoExternalMenuSummary[] }>(
    '/api/2/menu',
    { organizationIds },
    apiLogin
  );
  return data.externalMenus ?? [];
}

/** Fetch a specific external menu with all categories and items. */
export async function fetchIikoExternalMenuById(
  externalMenuId: string,
  organizationIds: string[],
  apiLogin?: string,
  language = 'ru'
): Promise<IikoExternalMenu> {
  return iikoPost<IikoExternalMenu>(
    '/api/2/menu/by_id',
    { externalMenuId, organizationIds, language },
    apiLogin
  );
}

export function mapIikoProductsToPosProducts(
  data: NomenclatureResponse,
  stopList: IikoStopListItem[] = []
): PosProduct[] {
  const stoppedIds = new Set(stopList.map((s) => s.productId));
  const products = data.products || [];
  const out: PosProduct[] = [];

  for (const p of products) {
    if (p.isDeleted) continue;
    const sizes = p.sizes && p.sizes.length > 0 ? p.sizes : [];
    if (sizes.length === 0) continue;

    for (const s of sizes) {
      if (typeof s.price !== 'number') continue;
      const compositeId = sizes.length === 1 ? p.id : `${p.id}:${s.id}`;
      out.push({
        id: compositeId,
        name: p.name
          ? sizes.length === 1
            ? p.name
            : `${p.name} (${s.name || s.id})`
          : p.id,
        price: s.price,
        isAvailable: !stoppedIds.has(p.id),
        sizeId: s.id,
      });
    }
  }

  return out;
}
