import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '@chatprint/shared';
import { assertObjectKey } from './keys.js';
import {
  DEFAULT_DOWNLOAD_SECONDS,
  DEFAULT_UPLOAD_SECONDS,
  MAX_SIGNED_URL_SECONDS,
  MAX_UPLOAD_BYTES,
  ObjectNotFoundError,
  PROVIDER_DOWNLOAD_SECONDS,
  StorageError,
  type CreateUploadInput,
  type ObjectStorage,
  type PresignedDownload,
  type PresignedUpload,
  type PutObjectInput,
  type StoredObject,
  type StoredObjectInfo,
} from './object-storage.js';

/**
 * ObjectStorage on any S3-compatible store (AWS S3, the local RustFS from
 * docker-compose, ...). Uploads use presigned POST so the store enforces the
 * size limit and content type.
 *
 * Signing uses the long-lived access key from config. Temporary (STS)
 * credentials would cut signed URLs short of their 7-day lifetime.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: StorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      region: config.region,
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Send checksums only where S3 requires them; several S3-compatible
      // stores reject the newer default checksum headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createUpload(input: CreateUploadInput): Promise<PresignedUpload> {
    assertObjectKey(input.key);
    const expiresIn = checkExpiry(input.expiresInSeconds ?? DEFAULT_UPLOAD_SECONDS);
    if (
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes < 1 ||
      input.maxBytes > MAX_UPLOAD_BYTES
    ) {
      throw new StorageError(`maxBytes must be an integer from 1 to ${MAX_UPLOAD_BYTES}`);
    }
    if (input.contentType.trim() === '') throw new StorageError('contentType is required');

    const expiresAt = expiryFromNow(expiresIn);
    const { url, fields } = await this.#call('sign an upload for', input.key, () =>
      createPresignedPost(this.#client, {
        Bucket: this.#bucket,
        Key: input.key,
        Fields: { 'Content-Type': input.contentType },
        Conditions: [['content-length-range', 1, input.maxBytes]],
        Expires: expiresIn,
      }),
    );
    return { url, fields, expiresAt, maxBytes: input.maxBytes };
  }

  async createDownloadUrl(
    key: string,
    expiresInSeconds = DEFAULT_DOWNLOAD_SECONDS,
  ): Promise<PresignedDownload> {
    assertObjectKey(key);
    const expiresIn = checkExpiry(expiresInSeconds);
    const expiresAt = expiryFromNow(expiresIn);
    const url = await this.#call('sign a download for', key, () =>
      getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
        expiresIn,
      }),
    );
    return { url, expiresAt };
  }

  createProviderDownloadUrl(key: string): Promise<PresignedDownload> {
    return this.createDownloadUrl(key, PROVIDER_DOWNLOAD_SECONDS);
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertObjectKey(input.key);
    await this.#call('write', input.key, () =>
      this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      ),
    );
  }

  async getObject(key: string): Promise<StoredObject> {
    assertObjectKey(key);
    const output = await this.#call('read', key, () =>
      this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key })),
    );
    if (output.Body === undefined) throw new StorageError(`Empty response reading ${key}`);
    const body = await output.Body.transformToByteArray();
    return {
      body,
      contentLength: output.ContentLength ?? body.byteLength,
      contentType: output.ContentType,
      etag: output.ETag,
      lastModified: output.LastModified,
    };
  }

  async headObject(key: string): Promise<StoredObjectInfo | null> {
    assertObjectKey(key);
    try {
      const output = await this.#call('inspect', key, () =>
        this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key })),
      );
      return {
        contentLength: output.ContentLength ?? 0,
        contentType: output.ContentType,
        etag: output.ETag,
        lastModified: output.LastModified,
      };
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertObjectKey(key);
    await this.#call('delete', key, () =>
      this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key })),
    );
  }

  /**
   * Creates the bucket if it doesn't exist. New buckets are private.
   * Development only: production buckets are provisioned outside the app.
   */
  async ensureBucket(): Promise<'created' | 'exists'> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
      return 'exists';
    } catch (error) {
      if (statusOf(error) !== 404) throw toStorageError(error, `check bucket ${this.#bucket}`);
    }
    try {
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    } catch (error) {
      throw toStorageError(error, `create bucket ${this.#bucket}`);
    }
    return 'created';
  }

  destroy(): void {
    this.#client.destroy();
  }

  async #call<T>(action: string, key: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw toStorageError(error, `${action} ${key}`);
    }
  }
}

function checkExpiry(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SIGNED_URL_SECONDS) {
    throw new StorageError(
      `Signed URL lifetime must be 1 to ${MAX_SIGNED_URL_SECONDS} seconds, got ${seconds}`,
    );
  }
  return seconds;
}

function expiryFromNow(seconds: number): Date {
  // Signers read the clock to the second; round down so we never overstate.
  return new Date(Math.floor(Date.now() / 1000) * 1000 + seconds * 1000);
}

function statusOf(error: unknown): number | undefined {
  return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
}

/** A missing key. HEAD responses have no body, so S3 can only say NotFound there. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

function toStorageError(error: unknown, what: string): StorageError {
  const detail =
    error instanceof S3ServiceException
      ? `${error.name}${statusOf(error) === undefined ? '' : ` (${statusOf(error)})`}`
      : error instanceof Error
        ? error.message
        : String(error);
  return new StorageError(`Failed to ${what}: ${detail}`, { cause: error });
}
