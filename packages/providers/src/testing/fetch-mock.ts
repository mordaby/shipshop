/**
 * A fetch stand-in for tests. Each route answers one "METHOD URL" with a
 * status and JSON body; calls are recorded; an unmatched request throws, so a
 * test never reaches the network by accident.
 */

export interface MockRoute {
  method: string;
  url: string;
  status?: number;
  body?: unknown;
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export interface FetchMock {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

export function mockFetch(routes: readonly MockRoute[]): FetchMock {
  const requests: RecordedRequest[] = [];

  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const route = routes.find((r) => r.method === request.method && r.url === request.url);
    return request.text().then((text) => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      });
      if (route === undefined) {
        throw new Error(`Unexpected request in test: ${request.method} ${request.url}`);
      }
      return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  };

  return { fetch: fetchImpl, requests };
}
