/**
 * Private object storage for designs, print files and mockups. Nothing is
 * public: clients and providers get short-lived signed URLs.
 */

/** AWS Signature V4 caps presigned URLs at 7 days. */
export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

/** Providers download print files from a signed link valid for at least 7 days (CLAUDE.md, rule 11). */
export const PROVIDER_DOWNLOAD_SECONDS = MAX_SIGNED_URL_SECONDS;

export const DEFAULT_UPLOAD_SECONDS = 15 * 60;
export const DEFAULT_DOWNLOAD_SECONDS = 15 * 60;

/** S3 accepts at most 5 GiB in one POST upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

/**
 * A browser-ready upload: POST multipart/form-data to `url` with every entry
 * of `fields` first and the file last, in a field named `file`. The store
 * itself rejects other keys, content types, sizes above `maxBytes`, and
 * requests after `expiresAt`.
 */
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
  maxBytes: number;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface StoredObjectInfo {
  contentLength: number;
  contentType: string | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
}

export interface StoredObject extends StoredObjectInfo {
  body: Uint8Array;
}

export interface CreateUploadInput {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds?: number;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array | string;
  contentType: string;
}

export interface ObjectStorage {
  createUpload(input: CreateUploadInput): Promise<PresignedUpload>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<PresignedDownload>;
  /** A download link for a print provider, valid for PROVIDER_DOWNLOAD_SECONDS. */
  createProviderDownloadUrl(key: string): Promise<PresignedDownload>;
  putObject(input: PutObjectInput): Promise<void>;
  /** Throws ObjectNotFoundError when the key doesn't exist. */
  getObject(key: string): Promise<StoredObject>;
  /** Returns null when the key doesn't exist. */
  headObject(key: string): Promise<StoredObjectInfo | null>;
  /** Succeeds whether or not the key exists. */
  deleteObject(key: string): Promise<void>;
}

export class StorageError extends Error {
  override name = 'StorageError';
}

export class ObjectNotFoundError extends StorageError {
  override name = 'ObjectNotFoundError';
  constructor(readonly key: string) {
    super(`No object at ${key}`);
  }
}
