import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local HTTP server that answers the S3 REST calls the adapter makes
 * (path-style bucket and object PUT/GET/HEAD/DELETE) with the status codes,
 * headers and XML error bodies S3 documents. It checks that each request is
 * SigV4-signed with the expected access key, not the signature itself; the
 * integration tests cover that against a real store.
 */
export interface FakeS3 {
  endpoint: string;
  objects: Map<string, { body: Buffer; contentType: string; lastModified: Date }>;
  requests: { method: string; path: string; authorization: string | undefined }[];
  /** Makes the next request fail with this status and S3 error code. */
  failNext(status: number, code: string): void;
  close(): Promise<void>;
}

export async function startFakeS3(bucket: string, accessKeyId: string): Promise<FakeS3> {
  const objects: FakeS3['objects'] = new Map();
  const requests: FakeS3['requests'] = [];
  let bucketExists = false;
  let failure: { status: number; code: string } | undefined;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const authorization = req.headers.authorization;
      requests.push({ method, path: url.pathname, authorization });

      const sendError = (status: number, code: string, key?: string) => {
        res.writeHead(status, { 'Content-Type': 'application/xml', 'x-amz-request-id': 'req-1' });
        res.end(
          method === 'HEAD'
            ? undefined
            : `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code>` +
                `<Message>${code}</Message>${key ? `<Key>${key}</Key>` : ''}` +
                '<RequestId>req-1</RequestId></Error>',
        );
      };

      if (!authorization?.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`)) {
        sendError(403, 'AccessDenied');
        return;
      }
      if (failure) {
        const { status, code } = failure;
        failure = undefined;
        sendError(status, code);
        return;
      }

      const [, bucketName, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      if (bucketName !== bucket) {
        sendError(404, 'NoSuchBucket');
        return;
      }

      if (key === '') {
        if (method === 'HEAD') {
          res.writeHead(bucketExists ? 200 : 404).end();
        } else if (method === 'PUT') {
          bucketExists = true;
          res.writeHead(200, { Location: `/${bucket}` }).end();
        } else {
          sendError(501, 'NotImplemented');
        }
        return;
      }

      const object = objects.get(key);
      switch (method) {
        case 'PUT': {
          const body = Buffer.concat(chunks);
          objects.set(key, {
            body,
            contentType: req.headers['content-type'] ?? 'binary/octet-stream',
            lastModified: new Date('2026-10-07T12:00:00Z'),
          });
          res.writeHead(200, { ETag: etag(body) }).end();
          return;
        }
        case 'GET':
        case 'HEAD': {
          if (!object) {
            sendError(404, 'NoSuchKey', key);
            return;
          }
          res.writeHead(200, {
            'Content-Type': object.contentType,
            'Content-Length': object.body.byteLength,
            ETag: etag(object.body),
            'Last-Modified': object.lastModified.toUTCString(),
          });
          res.end(method === 'GET' ? object.body : undefined);
          return;
        }
        case 'DELETE':
          objects.delete(key);
          res.writeHead(204).end();
          return;
        default:
          sendError(501, 'NotImplemented');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    failNext(status, code) {
      failure = { status, code };
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function etag(body: Buffer): string {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}

// ---------------------------------------------------------------------------
// Independent SigV4 checks (AWS "Authenticating Requests: Using Query
// Parameters" and "Browser-Based Uploads Using POST").

export function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/** Expected X-Amz-Signature for a presigned POST policy. */
export function postPolicySignature(
  secret: string,
  region: string,
  fields: Record<string, string>,
) {
  const date = (fields['X-Amz-Date'] ?? '').slice(0, 8);
  return hmac(signingKey(secret, date, region), fields.Policy ?? '').toString('hex');
}

/** Expected X-Amz-Signature for a presigned GET URL signed on the host header only. */
export function presignedGetSignature(secret: string, region: string, url: URL): string {
  const params = [...url.searchParams].filter(([name]) => name !== 'X-Amz-Signature');
  const canonicalQuery = params
    .map(([name, value]): [string, string] => [rfc3986(name), rfc3986(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const amzDate = url.searchParams.get('X-Amz-Date') ?? '';
  const date = amzDate.slice(0, 8);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${date}/${region}/s3/aws4_request`,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  return hmac(signingKey(secret, date, region), stringToSign).toString('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
