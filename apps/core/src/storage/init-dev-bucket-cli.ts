import { isProduction, readEnv, storageConfig } from '@chatprint/shared';
import { S3ObjectStorage } from './s3-object-storage.js';

// Creates the private bucket in the local S3-compatible store (docker-compose).
// Production buckets are provisioned with the hosting setup, not by the app.
try {
  const env = readEnv();
  if (isProduction(env)) {
    throw new Error('storage:init is for local development and refuses to run in production.');
  }
  const config = storageConfig(env);
  const storage = new S3ObjectStorage(config);
  try {
    const outcome = await storage.ensureBucket();
    console.log(`Bucket ${config.bucket} ${outcome === 'created' ? 'created' : 'already exists'}.`);
  } finally {
    storage.destroy();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
