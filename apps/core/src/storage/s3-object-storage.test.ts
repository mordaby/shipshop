import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  postPolicySignature,
  presignedGetSignature,
  startFakeS3,
  type FakeS3,
} from '../test/fake-s3.js';
import {
  MAX_SIGNED_URL_SECONDS,
  ObjectNotFoundError,
  PROVIDER_DOWNLOAD_SECONDS,
  StorageError,
} from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

const BUCKET = 'chatprint-test';
const ACCESS_KEY = 'test-access-key';
const SECRET = 'test-secret-key-never-in-urls';
const REGION = 'us-east-1';
const KEY = 'designs/0b8f3c2e-4f7a-4c1e-9d2a-6b5e8f1a2c3d/original.png';
const NOW = new Date('2026-10-07T12:00:00Z');

let s3: FakeS3;
let storage: S3ObjectStorage;

beforeAll(async () => {
  s3 = await startFakeS3(BUCKET, ACCESS_KEY);
  storage = new S3ObjectStorage({
    endpoint: s3.endpoint,
    region: REGION,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET,
    forcePathStyle: true,
  });
});

afterAll(async () => {
  storage.destroy();
  await s3.close();
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  s3.objects.clear();
  s3.requests.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createUpload', () => {
  it('returns a presigned POST the store will enforce', async () => {
    const upload = await storage.createUpload({
      key: KEY,
      contentType: 'image/png',
      maxBytes: 50_000_000,
    });

    expect(upload.url).toBe(`${s3.endpoint}/${BUCKET}`);
    expect(upload.maxBytes).toBe(50_000_000);
    expect(upload.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60 * 1000));
    expect(upload.fields).toMatchObject({
      key: KEY,
      'Content-Type': 'image/png',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${ACCESS_KEY}/20261007/${REGION}/s3/aws4_request`,
      'X-Amz-Date': '20261007T120000Z',
    });

    const policy = JSON.parse(Buffer.from(upload.fields.Policy!, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.expiration).toBe('2026-10-07T12:15:00Z');
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 50_000_000],
        { bucket: BUCKET },
        { key: KEY },
        { 'Content-Type': 'image/png' },
      ]),
    );
    expect(upload.fields['X-Amz-Signature']).toBe(
      postPolicySignature(SECRET, REGION, upload.fields),
    );
    expect(JSON.stringify(upload)).not.toContain(SECRET);
    expect(s3.requests).toHaveLength(0);
  });

  it('honours a custom lifetime', async () => {
    const upload = await storage.createUpload({
      key: KEY,
      contentType: 'image/jpeg',
      maxBytes: 1,
      expiresInSeconds: 60,
    });
    expect(upload.expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it.each([
    [{ maxBytes: 0 }, /maxBytes/],
    [{ maxBytes: 1.5 }, /maxBytes/],
    [{ maxBytes: 6 * 1024 ** 3 }, /maxBytes/],
    [{ expiresInSeconds: MAX_SIGNED_URL_SECONDS + 1 }, /lifetime/],
    [{ expiresInSeconds: 0 }, /lifetime/],
    [{ contentType: ' ' }, /contentType/],
    [{ key: '../etc/passwd' }, /Invalid object key/],
    [{ key: '/designs/x' }, /Invalid object key/],
  ])('rejects %j', async (overrides, message) => {
    await expect(
      storage.createUpload({ key: KEY, contentType: 'image/png', maxBytes: 100, ...overrides }),
    ).rejects.toThrow(message);
  });
});

describe('download URLs', () => {
  it('are signed GETs that expire in 15 minutes by default', async () => {
    const download = await storage.createDownloadUrl(KEY);
    const url = new URL(download.url);

    expect(`${url.origin}${url.pathname}`).toBe(`${s3.endpoint}/${BUCKET}/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      `${ACCESS_KEY}/20261007/${REGION}/s3/aws4_request`,
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      presignedGetSignature(SECRET, REGION, url),
    );
    expect(download.expiresAt).toEqual(new Date(NOW.getTime() + 900_000));
    expect(download.url).not.toContain(SECRET);
  });

  it('last 7 days for print providers', async () => {
    const download = await storage.createProviderDownloadUrl(KEY);
    const url = new URL(download.url);

    expect(PROVIDER_DOWNLOAD_SECONDS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(PROVIDER_DOWNLOAD_SECONDS));
    expect(download.expiresAt).toEqual(new Date('2026-10-14T12:00:00Z'));
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      presignedGetSignature(SECRET, REGION, url),
    );
  });

  it('cannot outlive the SigV4 limit', async () => {
    await expect(storage.createDownloadUrl(KEY, MAX_SIGNED_URL_SECONDS + 1)).rejects.toThrow(
      StorageError,
    );
  });
});

describe('objects', () => {
  it('round-trip through put, head, get and delete', async () => {
    const body = new TextEncoder().encode('png bytes');
    await storage.putObject({ key: KEY, body, contentType: 'image/png' });

    expect(s3.objects.get(KEY)?.contentType).toBe('image/png');
    expect(await storage.headObject(KEY)).toMatchObject({
      contentLength: body.byteLength,
      contentType: 'image/png',
    });
    const object = await storage.getObject(KEY);
    expect(new TextDecoder().decode(object.body)).toBe('png bytes');
    expect(object.etag).toMatch(/^"[0-9a-f]{32}"$/);

    await storage.deleteObject(KEY);
    expect(s3.objects.has(KEY)).toBe(false);
    expect(s3.requests.map((r) => r.method)).toEqual(['PUT', 'HEAD', 'GET', 'DELETE']);
    expect(s3.requests.every((r) => r.path === `/${BUCKET}/${KEY}`)).toBe(true);
  });

  it('report a missing key', async () => {
    await expect(storage.getObject(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(await storage.headObject(KEY)).toBeNull();
    await expect(storage.deleteObject(KEY)).resolves.toBeUndefined();
  });

  it('wrap other failures without leaking credentials', async () => {
    s3.failNext(403, 'AccessDenied');
    const error = await storage.getObject(KEY).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).not.toBeInstanceOf(ObjectNotFoundError);
    expect((error as Error).message).toBe(`Failed to read ${KEY}: AccessDenied (403)`);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('validate keys before any request', async () => {
    await expect(
      storage.putObject({ key: 'Designs/X', body: 'x', contentType: 'text/plain' }),
    ).rejects.toThrow(/Invalid object key/);
    expect(s3.requests).toHaveLength(0);
  });
});

describe('ensureBucket', () => {
  it('creates the bucket once', async () => {
    expect(await storage.ensureBucket()).toBe('created');
    expect(await storage.ensureBucket()).toBe('exists');
  });
});
