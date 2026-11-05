import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore, signV4 } from "../pipeline/storage";

describe("AWS Signature V4", () => {
  it("reproduces the worked GET Object example from the AWS S3 documentation", () => {
    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const { authorization } = signV4({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadHash: empty,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("audio store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(path.join(tmpdir(), "store-"));
    dirs.push(d);
    return d;
  };

  it("defaults to local files under public/audio", async () => {
    const root = tmp();
    const store = createStore({}, root);
    expect(store.kind).toBe("local");
    writeFileSync(path.join(store.dir, "abc.mp3"), "x");
    expect(await store.exists("abc.mp3")).toBe("/audio/abc.mp3");
    expect(await store.exists("nope.mp3")).toBeNull();
    expect(await store.publish(path.join(store.dir, "abc.mp3"))).toBe("/audio/abc.mp3");
  });

  it("switches to S3 only when fully configured, and uploads with a signed PUT", async () => {
    const env = { S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", S3_BUCKET: "shorts", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret", AUDIO_PUBLIC_URL: "https://pub.example.dev" };
    expect(createStore({ ...env, S3_BUCKET: undefined }, tmp()).kind).toBe("local");
    const store = createStore(env, tmp());
    expect(store.kind).toBe("s3");
    const file = path.join(store.dir, "k1.mp3");
    writeFileSync(file, "audio-bytes");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("", { status: 200 })));
    expect(await store.publish(file)).toBe("https://pub.example.dev/audio/k1.mp3");
    expect(calls[0].url).toBe("https://acct.r2.cloudflarestorage.com/shorts/audio/k1.mp3");
    const h = calls[0].init.headers as Record<string, string>;
    expect(calls[0].init.method).toBe("PUT");
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(h["content-type"]).toBe("audio/mpeg");
    expect(h["cache-control"]).toContain("immutable");
  });

  it("reports a failed upload", async () => {
    const env = { S3_ENDPOINT: "https://e", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "i", S3_SECRET_ACCESS_KEY: "s", AUDIO_PUBLIC_URL: "https://p" };
    const store = createStore(env, tmp());
    const file = path.join(store.dir, "k.mp3");
    writeFileSync(file, "x");
    vi.stubGlobal("fetch", async () => new Response("denied", { status: 403 }));
    await expect(store.publish(file)).rejects.toThrow(/403/);
  });
});
