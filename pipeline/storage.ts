import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/**
 * Where narration files live.
 *  - local (default): public/audio, committed to git, served by the app. Works with zero setup.
 *  - s3: any S3-compatible bucket (Cloudflare R2 free tier recommended). Files are written to a scratch dir,
 *    uploaded, and the short stores the absolute public URL, so the repo stays small.
 */
export interface AudioStore {
  kind: "local" | "s3";
  /** Directory the pipeline writes new files into before publishing. */
  dir: string;
  /** Public src for a published file name, or null if it isn't there yet. */
  exists(file: string): Promise<string | null>;
  /** Make a locally written file public; returns the src to store in data. */
  publish(localPath: string): Promise<string>;
}

const sha256 = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** ISO basic format, e.g. 20130524T000000Z */
  amzDate: string;
}

/** AWS Signature Version 4 (header-based). Verified against the worked example in the AWS S3 docs (see tests). */
export function signV4(i: SignInput): { authorization: string; headers: Record<string, string> } {
  const u = new URL(i.url);
  const service = i.service ?? "s3";
  const hdrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) hdrs[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  hdrs.host = u.host;
  hdrs["x-amz-date"] = i.amzDate;
  hdrs["x-amz-content-sha256"] = i.payloadHash;
  const names = Object.keys(hdrs).sort();
  const canonicalQuery = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
  const canonical = [i.method, u.pathname, canonicalQuery, names.map((n) => `${n}:${hdrs[n]}\n`).join(""), names.join(";"), i.payloadHash].join("\n");
  const date = i.amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), service), "aws4_request");
  const signature = hmac(key, toSign).toString("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, headers: hdrs };
}

const contentType = (f: string) => (f.endsWith(".mp3") ? "audio/mpeg" : f.endsWith(".wav") ? "audio/wav" : "application/octet-stream");

export function localStore(root = process.cwd()): AudioStore {
  const dir = path.join(root, "public", "audio");
  return {
    kind: "local",
    dir,
    async exists(file) {
      return existsSync(path.join(dir, file)) ? `/audio/${file}` : null;
    },
    async publish(localPath) {
      return `/audio/${path.basename(localPath)}`;
    },
  };
}

export function s3Store(env: Env, root = process.cwd()): AudioStore {
  const endpoint = (env.S3_ENDPOINT ?? "").replace(/\/$/, "");
  const bucket = env.S3_BUCKET ?? "";
  const publicBase = (env.AUDIO_PUBLIC_URL ?? "").replace(/\/$/, "");
  const prefix = (env.S3_PREFIX ?? "audio/").replace(/^\/+/, "");
  const dir = path.join(root, "pipeline", ".cache", "audio");
  const publicUrl = (file: string) => `${publicBase}/${prefix}${file}`;
  return {
    kind: "s3",
    dir,
    async exists(file) {
      if (existsSync(path.join(dir, file))) return publicUrl(file);
      const res = await fetch(publicUrl(file), { method: "HEAD", signal: AbortSignal.timeout(15_000) }).catch(() => null);
      return res?.ok ? publicUrl(file) : null;
    },
    async publish(localPath) {
      const file = path.basename(localPath);
      const body = readFileSync(localPath);
      const url = `${endpoint}/${bucket}/${prefix}${file}`;
      const extra = { "content-type": contentType(file), "cache-control": "public, max-age=31536000, immutable" };
      const signed = signV4({
        method: "PUT",
        url,
        headers: extra,
        payloadHash: sha256(body),
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
        region: env.S3_REGION || "auto",
        amzDate: new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
      });
      const { host: _host, ...sendHeaders } = signed.headers; // fetch sets Host itself
      void _host;
      const res = await fetch(url, { method: "PUT", headers: { ...sendHeaders, Authorization: signed.authorization }, body, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`S3 upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      return publicUrl(file);
    },
  };
}

/** S3 mode needs all of: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, AUDIO_PUBLIC_URL. Otherwise local. */
export function createStore(env: Env = process.env, root = process.cwd()): AudioStore {
  const s3 = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AUDIO_PUBLIC_URL"].every((k) => env[k]);
  const store = s3 ? s3Store(env, root) : localStore(root);
  mkdirSync(store.dir, { recursive: true });
  return store;
}
