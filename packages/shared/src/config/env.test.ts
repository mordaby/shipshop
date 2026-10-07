import { describe, expect, it } from 'vitest';
import {
  assertConfigured,
  databaseConfig,
  gelatoApiConfig,
  InvalidConfigError,
  MissingConfigError,
  readEnv,
  storageConfig,
} from './env.js';

const storageVars = {
  STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'chatprint-dev',
  STORAGE_ACCESS_KEY_ID: 'access-key',
  STORAGE_SECRET_ACCESS_KEY: 'secret-key',
};

describe('readEnv', () => {
  it('applies defaults to an empty environment', () => {
    const env = readEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PAYPAL_ENV).toBe('sandbox');
    expect(env.PAYMENT_PROCESSOR_SANDBOX).toBe(true);
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(false);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('treats blank values as unset, as .env.example leaves them', () => {
    const env = readEnv({ DATABASE_URL: '', GELATO_API_KEY: '   ', NODE_ENV: '' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.GELATO_API_KEY).toBeUndefined();
    expect(env.NODE_ENV).toBe('development');
  });

  it('parses booleans', () => {
    expect(readEnv({ STORAGE_FORCE_PATH_STYLE: 'true' }).STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(readEnv({ PAYMENT_PROCESSOR_SANDBOX: 'false' }).PAYMENT_PROCESSOR_SANDBOX).toBe(false);
  });

  it('names every invalid variable without echoing values', () => {
    const secret = 'not-a-url-but-maybe-a-secret';
    let error: unknown;
    try {
      readEnv({ DATABASE_URL: secret, PAYPAL_ENV: 'prod', STORAGE_ENDPOINT: 'ftp://x' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidConfigError);
    const { message, problems } = error as InvalidConfigError;
    expect(problems).toHaveLength(3);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PAYPAL_ENV');
    expect(message).toContain('STORAGE_ENDPOINT');
    expect(message).not.toContain(secret);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => readEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects dev-only providers that do not exist', () => {
    expect(() => readEnv({ PAYMENT_PROCESSOR: 'stripe' })).toThrow(/PAYMENT_PROCESSOR/);
  });
});

describe('feature accessors', () => {
  it('fail loudly, naming the missing variable', () => {
    const env = readEnv({});
    expect(() => databaseConfig(env)).toThrow(MissingConfigError);
    expect(() => databaseConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => gelatoApiConfig(env)).toThrow(/GELATO_API_KEY/);
  });

  it('list every missing storage variable at once', () => {
    const env = readEnv({ STORAGE_BUCKET: 'b' });
    try {
      storageConfig(env);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingConfigError);
      expect((error as MissingConfigError).missing).toEqual([
        'STORAGE_REGION',
        'STORAGE_ACCESS_KEY_ID',
        'STORAGE_SECRET_ACCESS_KEY',
      ]);
    }
  });

  it('return a populated section when configured', () => {
    const env = readEnv({ ...storageVars, STORAGE_FORCE_PATH_STYLE: 'true' });
    expect(storageConfig(env)).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'chatprint-dev',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      forcePathStyle: true,
    });
  });

  it('allow an empty storage endpoint for AWS S3', () => {
    const { STORAGE_ENDPOINT: _omit, ...vars } = storageVars;
    expect(storageConfig(readEnv(vars)).endpoint).toBeUndefined();
  });
});

describe('assertConfigured', () => {
  it('collects missing variables across features', () => {
    const env = readEnv({ ...storageVars });
    try {
      assertConfigured(env, ['database', 'storage', 'gelato']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingConfigError);
      expect((error as MissingConfigError).missing).toEqual(['DATABASE_URL', 'GELATO_API_KEY']);
      expect((error as Error).message).toBe(
        'Missing environment variables for the database and the Gelato API: ' +
          'DATABASE_URL, GELATO_API_KEY. Set in .env (see .env.example) or the secret manager.',
      );
    }
  });

  it('passes when everything is set', () => {
    const env = readEnv({
      ...storageVars,
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      GELATO_API_KEY: 'key',
    });
    expect(() => {
      assertConfigured(env, ['database', 'storage', 'gelato']);
    }).not.toThrow();
  });
});
