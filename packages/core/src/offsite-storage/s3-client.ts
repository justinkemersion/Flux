import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { OffsiteStorageConfig } from "./config.ts";
import { redactSensitiveText } from "./redact.ts";

export type OffsiteProvider = "r2" | "filesystem";

export type OffsiteUploadResult = {
  provider: OffsiteProvider;
  bucket: string;
  offsiteKey: string;
  etag?: string;
  sizeBytes: number;
};

export type S3OffsiteClientDeps = {
  send: (command: unknown) => Promise<unknown>;
};

export function createS3ClientFromConfig(config: OffsiteStorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  return new S3Client(clientConfig);
}

export class S3OffsiteClient {
  constructor(
    private readonly config: OffsiteStorageConfig,
    private readonly deps?: S3OffsiteClientDeps,
  ) {}

  private getSender(): (command: unknown) => Promise<unknown> {
    if (this.deps) {
      return (command) => this.deps!.send(command);
    }
    const c = createS3ClientFromConfig(this.config);
    return (command) =>
      c.send(command as Parameters<S3Client["send"]>[0]) as Promise<unknown>;
  }

  private async send<T>(command: unknown): Promise<T> {
    const send = this.getSender();
    try {
      return (await send(command)) as T;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Offsite storage operation failed: ${redactSensitiveText(msg)}`);
    }
  }

  async putObjectFromFile(
    localPath: string,
    offsiteKey: string,
    contentSha256?: string | null,
  ): Promise<OffsiteUploadResult> {
    const fs = await stat(localPath);
    if (!fs.isFile() || fs.size <= 0) {
      throw new Error(`Backup file missing or empty: ${localPath}`);
    }

    const metadata: Record<string, string> = {};
    const sha = contentSha256?.trim().toLowerCase();
    if (sha && /^[a-f0-9]{64}$/u.test(sha)) {
      metadata["content-sha256"] = sha;
    }

    const body = createReadStream(localPath);
    const result = await this.send<{ ETag?: string }>(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: offsiteKey,
        Body: body,
        ContentLength: fs.size,
        Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      }),
    );

    const etag = result.ETag?.replace(/^"|"$/g, "");
    return {
      provider: "r2",
      bucket: this.config.bucket,
      offsiteKey,
      sizeBytes: Number(fs.size),
      ...(etag ? { etag } : {}),
    };
  }

  async headObject(offsiteKey: string): Promise<{ etag?: string; sizeBytes?: number }> {
    const result = await this.send<{ ETag?: string; ContentLength?: number }>(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: offsiteKey,
      }),
    );
    const etag = result.ETag?.replace(/^"|"$/g, "");
    const sizeBytes = result.ContentLength;
    return {
      ...(etag ? { etag } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    };
  }

  async listObjectsByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.send<{
        Contents?: Array<{ Key?: string }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      }>(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of result.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async getObject(offsiteKey: string): Promise<ReadableStream<Uint8Array>> {
    const result = await this.send<{ Body?: unknown }>(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: offsiteKey,
      }),
    );
    const body = result.Body;
    if (!body || typeof (body as { transformToWebStream?: unknown }).transformToWebStream !== "function") {
      throw new Error("Offsite getObject returned no readable body.");
    }
    return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  }

  async deleteObject(offsiteKey: string): Promise<void> {
    await this.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: offsiteKey,
      }),
    );
  }
}
