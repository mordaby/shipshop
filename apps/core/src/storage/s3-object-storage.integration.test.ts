import { readEnv, storageConfig } from '@chatprint/shared';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectNotFoundError } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

// Runs against the docker-compose S3-compatible store (STORAGE_* in .env).
// Objects go under a random prefix and are deleted afterwards.
const config = storageConfig(readEnv());
const storage = new S3ObjectStorage(config);
const prefix = `integration-tests/${randomUUID()}`;
const created: string[] = [];

function newKey(name: string): string {
  const key = `${prefix}/${name}`;
  created.push(key);
  return key;
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function postUpload(
  upload: { url: string; fields: Record<string, string> },
  file: Blob,
  overrideFields: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries({ ...upload.fields, ...overrideFields })) {
    form.append(name, value);
  }
  form.append('file', file, 'design.png');
  return fetch(upload.url, { method: 'POST', body: form });
}

beforeAll(async () => {
  await storage.ensureBucket();
});

afterAll(async () => {
  for (const key of created) await storage.deleteObject(key);
  storage.destroy();
});

describe('presigned POST upload', () => {
  it('accepts the file and serves it back on a signed GET', async () => {
    const key = newKey('ok.png');
    const upload = await storage.createUpload({ key, contentType: 'image/png', maxBytes: 1024 });

    const response = await postUpload(upload, new Blob([png], { type: 'image/png' }));
    expect(response.status).toBeLessThan(300);

    const download = await fetch((await storage.createDownloadUrl(key)).url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png);
  });

  it('rejects a file over maxBytes', async () => {
    const key = newKey('too-big.png');
    const upload = await storage.createUpload({ key, contentType: 'image/png', maxBytes: 8 });

    const response = await postUpload(upload, new Blob([png], { type: 'image/png' }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.headObject(key)).toBeNull();
  });

  it('rejects another content type', async () => {
    const key = newKey('wrong-type.png');
    const upload = await storage.createUpload({ key, contentType: 'image/png', maxBytes: 1024 });

    const response = await postUpload(upload, new Blob([png]), { 'Content-Type': 'text/html' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.headObject(key)).toBeNull();
  });

  it('rejects another key', async () => {
    const key = newKey('signed.png');
    const other = newKey('other.png');
    const upload = await storage.createUpload({ key, contentType: 'image/png', maxBytes: 1024 });

    const response = await postUpload(upload, new Blob([png], { type: 'image/png' }), {
      key: other,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.headObject(other)).toBeNull();
  });
});

describe('signed GET', () => {
  it('works for providers and is denied without a signature', async () => {
    const key = newKey('print.png');
    await storage.putObject({ key, body: png, contentType: 'image/png' });

    const provider = await storage.createProviderDownloadUrl(key);
    expect((await fetch(provider.url)).status).toBe(200);

    const unsigned = new URL(provider.url);
    unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it('is denied when the signature is tampered with', async () => {
    const key = newKey('tamper.png');
    await storage.putObject({ key, body: png, contentType: 'image/png' });
    const url = new URL((await storage.createDownloadUrl(key)).url);
    const signature = url.searchParams.get('X-Amz-Signature')!;
    url.searchParams.set(
      'X-Amz-Signature',
      signature.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
    );

    expect((await fetch(url)).status).toBe(403);
  });

  it('is denied after it expires', async () => {
    const key = newKey('expiring.png');
    await storage.putObject({ key, body: png, contentType: 'image/png' });
    const { url } = await storage.createDownloadUrl(key, 1);

    await sleep(2_100);

    expect((await fetch(url)).status).toBe(403);
  });
});

describe('server-side objects', () => {
  it('round-trip and report missing keys', async () => {
    const key = newKey('roundtrip.png');
    await storage.putObject({ key, body: png, contentType: 'image/png' });

    expect(await storage.headObject(key)).toMatchObject({
      contentLength: png.byteLength,
      contentType: 'image/png',
    });
    expect((await storage.getObject(key)).body).toEqual(png);

    await storage.deleteObject(key);
    expect(await storage.headObject(key)).toBeNull();
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});
