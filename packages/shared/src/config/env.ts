import { z } from 'zod';

/**
 * The one typed config module. Every key and URL the apps use comes from
 * environment variables and is declared here. Keys are optional at parse time
 * so that a feature fails only when it runs; use the feature accessors below
 * (databaseConfig, storageConfig, ...) to get a fully populated section, and
 * assertConfigured() at startup in production.
 *
 * Error messages name variables, never their values.
 */

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalHttpUrl = z.preprocess(
  blankToUndefined,
  z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }).optional(),
);
const optionalBoolean = (defaultValue: boolean) =>
  z.preprocess(blankToUndefined, z.stringbool().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    blankToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),

  // App URLs
  PUBLIC_BASE_URL: optionalHttpUrl,
  CORE_API_URL: optionalHttpUrl,
  MCP_PUBLIC_URL: optionalHttpUrl,

  // Database
  DATABASE_URL: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }).optional(),
  ),

  // File storage (S3-compatible)
  STORAGE_ENDPOINT: optionalHttpUrl,
  STORAGE_REGION: optionalString,
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY_ID: optionalString,
  STORAGE_SECRET_ACCESS_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: optionalBoolean(false),

  // Auth
  OAUTH_ISSUER: optionalHttpUrl,
  JWT_SIGNING_KEY: optionalString,

  // Gelato
  GELATO_API_KEY: optionalString,
  GELATO_WEBHOOK_SECRET: optionalString,

  // Israeli payment processor. TODO(decision): add the chosen processor; fake is dev only.
  PAYMENT_PROCESSOR: z.preprocess(blankToUndefined, z.enum(['fake']).optional()),
  PAYMENT_PROCESSOR_API_KEY: optionalString,
  PAYMENT_PROCESSOR_WEBHOOK_SECRET: optionalString,
  PAYMENT_PROCESSOR_SANDBOX: optionalBoolean(true),

  // PayPal
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  PAYPAL_ENV: z.preprocess(blankToUndefined, z.enum(['sandbox', 'live']).default('sandbox')),

  // AI models. TODO(decision): vendors not chosen yet.
  IMAGE_MODEL_API_KEY: optionalString,
  UPSCALER_API_KEY: optionalString,
  VISION_MODEL_API_KEY: optionalString,

  // SMS and email. TODO(decision): vendor not chosen yet; console is dev only.
  SMS_PROVIDER: z.preprocess(blankToUndefined, z.enum(['console']).optional()),
  EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(['console']).optional()),
  SMS_PROVIDER_API_KEY: optionalString,
  SMS_SENDER_ID: optionalString,
  EMAIL_PROVIDER_API_KEY: optionalString,
  EMAIL_FROM: z.preprocess(blankToUndefined, z.email().optional()),

  // Invoicing. TODO(decision): vendor not chosen yet.
  INVOICING_API_KEY: optionalString,
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** A variable has a value that doesn't match its schema. */
export class InvalidConfigError extends ConfigError {
  override name = 'InvalidConfigError';
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** A feature ran without the variables it needs. */
export class MissingConfigError extends ConfigError {
  override name = 'MissingConfigError';
  constructor(
    readonly feature: string,
    readonly missing: readonly string[],
  ) {
    super(
      `Missing environment variable${missing.length > 1 ? 's' : ''} for ${feature}: ${missing.join(', ')}. ` +
        'Set in .env (see .env.example) or the secret manager.',
    );
  }
}

/**
 * Parses and validates the environment. Blank values count as unset. Throws
 * InvalidConfigError listing every bad variable by name.
 */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

type PresentKeys<K extends EnvKey> = { [P in K]-?: NonNullable<Env[P]> };

function requireKeys<K extends EnvKey>(
  env: Env,
  feature: string,
  keys: readonly K[],
): PresentKeys<K> {
  const missing = keys.filter((key) => env[key] === undefined);
  if (missing.length > 0) {
    throw new MissingConfigError(feature, missing);
  }
  return Object.fromEntries(keys.map((key) => [key, env[key]])) as PresentKeys<K>;
}

export interface DatabaseConfig {
  url: string;
}

export function databaseConfig(env: Env): DatabaseConfig {
  const { DATABASE_URL } = requireKeys(env, 'the database', ['DATABASE_URL']);
  return { url: DATABASE_URL };
}

export interface StorageConfig {
  /** Empty for AWS S3, which derives the endpoint from the region. */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function storageConfig(env: Env): StorageConfig {
  const keys = requireKeys(env, 'file storage', [
    'STORAGE_REGION',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ]);
  return {
    endpoint: env.STORAGE_ENDPOINT,
    region: keys.STORAGE_REGION,
    bucket: keys.STORAGE_BUCKET,
    accessKeyId: keys.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: keys.STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  };
}

export interface GelatoApiConfig {
  apiKey: string;
}

export function gelatoApiConfig(env: Env): GelatoApiConfig {
  const { GELATO_API_KEY } = requireKeys(env, 'the Gelato API', ['GELATO_API_KEY']);
  return { apiKey: GELATO_API_KEY };
}

const FEATURES = {
  database: databaseConfig,
  storage: storageConfig,
  gelato: gelatoApiConfig,
} satisfies Record<string, (env: Env) => unknown>;

export type ConfigFeature = keyof typeof FEATURES;

/**
 * Checks every listed feature at once and throws one error naming all the
 * missing variables. Call it at startup in production.
 */
export function assertConfigured(env: Env, features: readonly ConfigFeature[]): void {
  const failures: MissingConfigError[] = [];
  for (const feature of features) {
    try {
      FEATURES[feature](env);
    } catch (error) {
      if (!(error instanceof MissingConfigError)) throw error;
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new MissingConfigError(failures.map((f) => f.feature).join(' and '), [
      ...new Set(failures.flatMap((f) => f.missing)),
    ]);
  }
}
