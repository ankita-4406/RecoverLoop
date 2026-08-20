const API_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export class RequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "RequestValidationError";
  }
}

export function correlationIdFor(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && CORRELATION_ID_PATTERN.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function jsonResponse(
  body: unknown,
  correlationId: string,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);

  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Correlation-ID", correlationId);

  return new Response(JSON.stringify(body), { ...init, headers });
}

export function requireJsonContentType(request: Request): void {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (mediaType !== "application/json") {
    throw new RequestValidationError(415, "Content-Type must be application/json");
  }
}

export function requireSameOriginMutation(request: Request): void {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (request.headers.get("x-recoverloop-action") !== "demo") {
    throw new RequestValidationError(403, "Request origin is not allowed");
  }

  if (origin && origin !== requestOrigin) {
    throw new RequestValidationError(403, "Request origin is not allowed");
  }

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestValidationError(403, "Request origin is not allowed");
  }
}

export async function readRequestBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");

  if (contentLength && !/^\d+$/.test(contentLength)) {
    throw new RequestValidationError(400, "Invalid Content-Length header");
  }

  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestValidationError(413, "Request body is too large");
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size violation remains authoritative if the peer closes abruptly.
      }
      throw new RequestValidationError(413, "Request body is too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) {
    throw new RequestValidationError(400, "Request body must not be empty");
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestValidationError(400, "Request body must be valid JSON");
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyHmacSha256(
  secret: string,
  payload: Uint8Array,
  signatureHex: string,
): Promise<boolean> {
  if (!/^[0-9a-fA-F]{64}$/.test(signatureHex)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(payload)),
  );
  return constantTimeEqual(expected, hexToBytes(signatureHex));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
