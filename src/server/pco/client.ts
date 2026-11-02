/**
 * Minimal, dependency-free Planning Center REST client.
 *
 * Auth: Personal Access Token (HTTP Basic). The secret is never logged.
 * Docs: https://developer.planning.center/docs/
 *
 * Behaviours:
 *  - retries 429 / 5xx with exponential backoff (honouring Retry-After)
 *  - serialises requests with a minimum interval (PCO rate limits are low)
 *  - surfaces typed errors so the sync engine can distinguish auth failures
 *    from missing resources
 */

export class PcoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'PcoApiError';
  }
}

export class PcoAuthError extends PcoApiError {
  constructor(message: string, detail?: string) {
    super(message, 401, 'pco_auth_failed', detail);
    this.name = 'PcoAuthError';
  }
}

export class PcoNotFoundError extends PcoApiError {
  constructor(message: string) {
    super(message, 404, 'pco_not_found');
    this.name = 'PcoNotFoundError';
  }
}

export interface PcoJsonApiDocument<T = Record<string, unknown>> {
  data: T | T[];
  included?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

export interface PcoClientOptions {
  appId: string;
  secret: string;
  baseUrl?: string;
  /** Milliseconds between requests. PCO allows 100 requests/minute. */
  minIntervalMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Injectable sleep for tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class PcoClient {
  private readonly appId: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly authHeader: string;
  private lastRequestAt = 0;

  constructor(options: PcoClientOptions) {
    if (!options.appId || !options.secret) {
      throw new PcoAuthError('Planning Center credentials are not configured');
    }
    this.appId = options.appId;
    this.secret = options.secret;
    this.baseUrl = (options.baseUrl ?? 'https://api.planningcenteronline.com').replace(/\/+$/, '');
    this.minIntervalMs = options.minIntervalMs ?? 650;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.authHeader = `Basic ${Buffer.from(`${options.appId}:${options.secret}`, 'utf8').toString('base64')}`;
  }

  /** Build a URL with JSON:API style query parameters. */
  buildUrl(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) await this.sleepImpl(wait);
    this.lastRequestAt = Date.now();
  }

  async request<T = Record<string, unknown>>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<PcoJsonApiDocument<T>> {
    const url = this.buildUrl(path, params);
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      await this.throttle();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
            'User-Agent': 'pco-prime-sync (open source)',
          },
        });
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt > this.maxRetries) break;
        await this.sleepImpl(500 * 2 ** (attempt - 1));
        continue;
      }

      if (response.ok) {
        return (await response.json()) as PcoJsonApiDocument<T>;
      }

      if (response.status === 401 || response.status === 403) {
        throw new PcoAuthError(
          'Planning Center rejected the credentials. Check PCO_APP_ID and PCO_SECRET and that the token has Services access.',
        );
      }
      if (response.status === 404) {
        throw new PcoNotFoundError(`Planning Center resource not found: ${path}`);
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        attempt += 1;
        if (attempt > this.maxRetries) {
          throw new PcoApiError(
            `Planning Center request failed after ${this.maxRetries} retries (status ${response.status})`,
            response.status,
            'pco_rate_limited',
          );
        }
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        await this.sleepImpl(Math.min(backoff, 15_000));
        continue;
      }

      const body = await safeText(response);
      throw new PcoApiError(
        `Planning Center request failed with status ${response.status}`,
        response.status,
        'pco_request_failed',
        body.slice(0, 500),
      );
    }

    throw new PcoApiError(
      `Planning Center request failed: ${lastError instanceof Error ? lastError.message : 'network error'}`,
      0,
      'pco_network_error',
    );
  }

  /**
   * Fetch every page of a collection, with a hard page cap so a bad query can
   * never loop forever.
   */
  async paginate<T = Record<string, unknown>>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    options: { maxPages?: number; stopWhen?: (doc: PcoJsonApiDocument<T>) => boolean } = {},
  ): Promise<Array<T>> {
    const maxPages = options.maxPages ?? 25;
    const perPage = Number(params.per_page ?? 100);
    const rows: T[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * perPage;
      const doc = await this.request<T>(path, { ...params, per_page: perPage, offset });
      const data = Array.isArray(doc.data) ? doc.data : [doc.data];
      rows.push(...data);
      if (data.length < perPage) break;
      if (options.stopWhen?.(doc)) break;
    }
    return rows;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Decode a JSON:API resource object into a flat, convenient shape. */
export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
}

export function toResource(raw: unknown): JsonApiResource | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' && typeof record.id !== 'number') return null;
  return {
    id: String(record.id),
    type: String(record.type ?? ''),
    attributes: (record.attributes as Record<string, unknown>) ?? {},
    relationships:
      (record.relationships as JsonApiResource['relationships']) ?? {},
  };
}

/** Read a to-one relationship id from a resource. */
export function relatedId(resource: JsonApiResource, name: string): string | null {
  const rel = resource.relationships[name]?.data;
  if (!rel || Array.isArray(rel)) return null;
  return rel.id ?? null;
}

/** Index the `included` array of a JSON:API document by `${type}:${id}`. */
export function indexIncluded(included: Array<Record<string, unknown>> | undefined): Map<string, JsonApiResource> {
  const map = new Map<string, JsonApiResource>();
  for (const entry of included ?? []) {
    const resource = toResource(entry);
    if (resource) map.set(`${resource.type}:${resource.id}`, resource);
  }
  return map;
}
