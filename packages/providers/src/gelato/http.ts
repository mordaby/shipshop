import type { z } from 'zod';

/** Problems talking to Gelato: network failure, timeout, or a response we can't read. */
export class GelatoError extends Error {
  override name = 'GelatoError';
}

/** Gelato answered with a non-2xx status. */
export class GelatoApiError extends GelatoError {
  override name = 'GelatoApiError';
  constructor(
    readonly status: number,
    readonly method: string,
    readonly url: string,
    readonly code: string | undefined,
    readonly requestId: string | undefined,
    detail: string | undefined,
  ) {
    super(
      `Gelato ${method} ${url} failed with ${status}` +
        (code ? ` (${code})` : '') +
        (detail ? `: ${detail}` : '') +
        (requestId ? ` [requestId ${requestId}]` : ''),
    );
  }
}

export interface GelatoHttpOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Minimal JSON client for Gelato's REST APIs. Authenticates with the
 * X-API-KEY header and validates every response body against a schema.
 * The key never appears in errors.
 */
export class GelatoHttpClient {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: GelatoHttpOptions) {
    if (options.apiKey.trim() === '') {
      throw new GelatoError('Gelato API key is empty');
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<T>(
    method: 'GET' | 'POST',
    url: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-API-KEY': this.#apiKey,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new GelatoError(`Gelato ${method} ${url} did not complete: ${describe(error)}`, {
        cause: error,
      });
    }

    const text = await response.text();
    const json = parseJson(text);

    if (!response.ok) {
      const errorBody = isRecord(json) ? json : {};
      throw new GelatoApiError(
        response.status,
        method,
        url,
        stringField(errorBody, 'code'),
        stringField(errorBody, 'requestId'),
        stringField(errorBody, 'message') ?? (json === undefined ? text.slice(0, 200) : undefined),
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new GelatoError(`Gelato ${method} ${url} returned an unexpected body: ${issues}`);
    }
    return parsed.data;
  }
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'timed out' : error.message;
  return String(error);
}
