import { PassThrough, type Readable } from "node:stream";

const MAX_LOG_FRAME = 2 * 1024 * 1024;

/**
 * Strips the Docker 8-byte multiplex frame prefix from a full buffer (non-streaming `logs` call).
 */
function demuxDockerRawBuffer(buffer: Buffer): Buffer {
  let offset = 0;
  const parts: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    if (size < 0 || size > MAX_LOG_FRAME) {
      throw new Error("Invalid Docker log frame (size out of range)");
    }
    if (offset + 8 + size > buffer.length) {
      break;
    }
    parts.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return parts.length > 0 ? Buffer.concat(parts) : buffer;
}

/**
 * Converts a multiplexed Docker `logs` stream to a single binary payload `Readable` (no headers).
 * Apply {@link demuxDockerRawBuffer} to each buffer when `follow` is false and the API returns one chunk.
 */
export function demuxDockerLogStream(
  source: Readable,
  options?: { signal?: AbortSignal },
): Readable {
  const out = new PassThrough();
  let buffer = Buffer.alloc(0);

  const onAbort = (): void => {
    source.destroy();
    out.destroy();
  };

  if (options?.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  const onData = (chunk: Buffer | Uint8Array | string): void => {
    const c = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, c]);
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      if (size < 0 || size > MAX_LOG_FRAME) {
        out.destroy(new Error("Invalid Docker log frame (size out of range)"));
        return;
      }
      if (buffer.length < 8 + size) {
        return;
      }
      const payload = buffer.subarray(8, 8 + size);
      buffer = buffer.subarray(8 + size);
      out.write(payload);
    }
  };

  const onEnd = (): void => {
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      if (size < 0 || size > MAX_LOG_FRAME) {
        out.destroy(new Error("Invalid Docker log frame (size out of range)"));
        return;
      }
      if (buffer.length < 8 + size) {
        break;
      }
      const payload = buffer.subarray(8, 8 + size);
      buffer = buffer.subarray(8 + size);
      out.write(payload);
    }
    out.end();
  };

  source.on("data", onData);
  source.on("end", onEnd);
  source.on("error", (err: Error) => {
    out.destroy(err);
  });
  return out;
}

/**
 * If `container.logs` without `follow` returns a full buffer, strip multiplex headers.
 */
export function demuxDockerLogBufferIfMultiplexed(buffer: Buffer): Buffer {
  if (buffer.length < 8) {
    return buffer;
  }
  return demuxDockerRawBuffer(buffer);
}
