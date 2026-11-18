# News Shorts — developer notes

Everything a developer (or a fresh coding session) needs to continue the project: why it's built this way, how to run it, what's configured, what's broken, and what's next.

> **v2 (this branch):** nothing depends on Gemini any more. Narration runs locally with Kokoro-82M, word timings come from Whisper, story clustering uses a local embedding model, scripts are written by Groq, and any short can be exported as a vertical MP4. See §8 for what changed.

---

## 1. Approach analysis

### 1.1 How do we make "Shorts for news" cheaply?

Goal: a vertical, swipeable feed of 60–90 second narrated explainers that *feels* like Shorts/Reels, refreshed several times a day across 7 tracks (≈20–30 stories per refresh).

| Approach | Cost per 75 s short* | Quality | Feasibility / risk |
|---|---|---|---|
| **A. Generative AI video** (Veo, Sora, Runway, Kling, Luma) | **~$10–$55** (published API prices have been roughly $0.15–$0.75 per generated second; clips are 5–10 s, so a 75 s short needs 8–15 stitched clips) | Looks impressive, but **invents footage of real events**: synthetic "news footage" is a misinformation risk and would mislead viewers. Text and numbers in frames are unreliable. | Minutes of render time per clip, strict quotas, no meaningful free tier. 25 shorts × 4 refreshes/day ≈ **$1,000–$5,000/day**. Not viable, and editorially wrong for news. |
| **B. AI presenter avatar** (HeyGen, D-ID, Synthesia) | ~$1–$4 per minute on paid plans; free tiers are a few minutes per month with watermarks | Talking head is familiar but uncanny; still needs visuals for numbers/maps | Free tiers can't sustain a daily feed. |
| **C. Narrated animated story cards (chosen)** | **≈ $0**: LLM script + local TTS; visuals rendered *in the browser* | Kinetic captions, count-up numbers, charts, a spinning globe and timelines are *more informative* than stock footage, and every pixel is derived from verified text. | Fully feasible on free tiers. Audio is ~500 KB per short (48 kbps MP3). No publisher imagery used. |
| D. Stock footage/photos (Pexels/Pixabay) + TTS | Free with attribution | Generic B-roll rarely matches a specific story; it reads as filler | Easy add-on later; low value. |
| E. AI-generated illustrations per scene | Free tiers are small | Photoreal images of real events are misleading; abstract art adds little | Possible later for *abstract* section art only. |
| F. Server-rendered MP4 of the cards | Compute only | Same look as C, postable to YouTube Shorts / Reels | **Built in v2** (§1.5). |
| G. Audio-only "news podcast" | ≈ $0 | Loses the visual hook | Falls out of C for free (the narration files exist). |

\*Video prices change quickly; figures are order-of-magnitude from last-known public pricing and should be re-checked before relying on them.

**Decision:** approach **C**, with **F** as an export format.

### 1.2 Narration engine

Measured on this project's actual keys and a 4-core CPU sandbox (2026-11-04/05).

| Engine | Cost / limits | Quality | Verdict |
|---|---|---|---|
| **Kokoro-82M** (open weights, Apache-2.0), run locally via `kokoro-js` + onnxruntime-node, q8 ONNX (92 MB) | Free, **no quota, no key**. ~1.8× realtime on 4 CPU cores (77 s of audio in ~42 s). 54 voices; English and Hindi both work | Clear, natural, consistent. Audibly synthetic on long sentences, but a clear step above most OS voices | **Primary.** Round-trip check: Whisper transcribes the English output back verbatim, and the Hindi output at ≈95% word match |
| Gemini TTS (`gemini-3.8-flash-lite-tts`, `…-flash-tts`) | Free tier gave **8 narrations** (5 + 3) before HTTP 429; community reports ~10 requests/day/model | Best quality of the options | Optional provider only (`TTS_PROVIDERS=gemini,kokoro`). Never required |
| Groq Orpheus (`canopylabs/orpheus-v1-english`) | Listed on the account, but calls fail with `model_terms_required`: an org admin must accept the terms in the Groq console | Expressive | Not integrated (blocked, see §7). English-only, so it couldn't cover Hindi anyway |
| Browser Web Speech API | Free, zero setup | Varies wildly by device | Kept as the last-resort fallback when a short has no audio |

### 1.3 Exact captions: where do word timings come from?

| Option | Result |
|---|---|
| Kokoro-native timestamps | The `onnx-community/Kokoro-82M-v1.0-ONNX` graph has a single output (`waveform`); no durations are exposed (verified with `InferenceSession.outputNames`). The Python `kokoro` package does expose token timestamps but pulls PyTorch (GBs), which is unacceptable for CI |
| **Per-segment synthesis** (chosen, always on) | Each script segment is synthesised separately and the sample counts give **exact segment boundaries**. Word timing inside a segment is then constrained to its window |
| **Groq `whisper-large-v3-turbo`** word timestamps (chosen, first choice) | Free; ~1–3 s per clip. English: 165/166 words matched on the test short. Hindi typically 70–95%, worst seen 43% (Whisper normalises Hindi spelling) |
| **Local Whisper** (`Xenova/whisper-base.en`, transformers.js) (fallback) | No API at all; 17 s of audio in 4.8 s, including the first-run download |
| Estimate from text | Last resort (device voice, old data). Same as v1 |

Recognised words are matched to script words by an order-preserving DP (weighted LCS with a fuzzy similarity), *inside each segment window*, so a recognition error can never drift across segments. Unmatched words are interpolated between matched neighbours.

### 1.4 Story clustering

Calibrated on 503 real articles from 33 feeds (2026-11-05):

| Method | Stories covered by 2+ outlets | by 3+ outlets |
|---|---|---|
| Lexical (token Jaccard, union-find), v1 | 14 | 2 |
| **Local MiniLM embeddings, average-linkage, cosine ≥ 0.60** (chosen) | **28** | **4** |
| …same at 0.55 / 0.65 / 0.70 | 34 / 22 / 15 | 7 / 3 / 3 |

Gemini embeddings (`gemini-embedding-001`) were tried first and worked (cosine 0.88 on a related headline pair), but the free quota ran out mid-calibration, which is why the project moved to `Xenova/all-MiniLM-L6-v2` (22 MB, CPU, no key). Merges were inspected by eye at each threshold; 0.60 had a handful of loose merges (e.g. two different Trump/midterm angles) and no merges of unrelated topics. Average linkage (rather than single link) stops chains of loosely related headlines fusing. The lexical method remains as an automatic fallback when the embedding model can't load.

### 1.5 Video export

| Option | Verdict |
|---|---|
| Remotion | Great DX, but a company licence is required above a small team size and it adds a heavy dependency tree |
| ffmpeg `drawtext`/ASS only | Would mean re-implementing the globe, charts and kinetic text in a second renderer |
| Screen-record the live app | Real-time, non-deterministic, no audio sync guarantees |
| **Deterministic frame render (chosen)** | A chrome-less `/render/[id]` page where every pixel is a pure function of a time value. Playwright steps the clock frame by frame (CSS animations are *seeked*, not played), screenshots each frame and pipes JPEGs into ffmpeg with the narration. Identical visuals to the app |

### 1.6 Free-tier reality check (2026-11-05)

- **Gemini**: quota exhausted for text, embeddings and TTS on the provided key. The project therefore must not (and does not) depend on it; it stays an optional extra for LLM and TTS.
- **Groq**: `openai/gpt-oss-120b` writes the scripts (~$0). Free tier is token-per-minute limited; the provider honours `retry-after`, falls back to `gpt-oss-20b`, and the pipeline reuses scripts for 72 h to stay inside limits. Whisper large-v3-turbo has its own generous free quota.
- **Hugging Face** is reachable from the sandbox for weights (Kokoro, MiniLM, Whisper); the first run downloads ≈115 MB, cached in `pipeline/.cache/models`.

---

## 2. Architecture

```
pipeline/ (Node, run by cron)                              src/ (Next.js app, static)
  feeds.ts     outlets per track                              app/page.tsx        feed  (/)
  rss.ts       fetch + parse RSS 2.0 / RDF / Atom             app/catch-up        3-min playlist
  cluster.ts   dedupe, embedding clustering (+ lexical        app/s/[id]          share deep link
               fallback), track assignment, picks             app/saved           saved list
  embed.ts     local MiniLM (transformers.js) + disk cache    app/render/[id]     frame-exact view for MP4 export
  llm/         provider abstraction: Groq (default), Gemini   components/         FeedApp, ShortCard, Scene, GlobeMap,
  script.ts    prompt, zod schema, originality guard,                             Captions, Sheet (coverage view), RenderStage
               number grounding, coverage comparison          hooks/usePlayback   one clock, 3 narration engines
  translate.ts Hindi adaptation of our own English script     lib/timeline       exact/estimated word timing, visual cues
  tts/         Kokoro (en + hi, local), Gemini (optional)     lib/i18n           localize(short, lang)
  audio.ts     PCM/WAV/MP3, silence trim, normalise           lib/playlist       feed order, catch-up selection
  align.ts     Whisper (Groq → local) + word aligner        scripts/
  storage.ts   local (git) or S3-compatible store + SigV4       export-video.mjs  Playwright + ffmpeg → 1080×1920 MP4
  narrate.ts   cache → synth → encode → publish → align      public/sw.js         offline cache (PWA)
  run.ts       orchestrates → data/shorts.json
```

- **Data contract:** `src/lib/types.ts`. A `Short` has `segments`, `coverage`, `coverageSummary`, `audio` (`src`, `durationSec`, `wordTimes`…) and optional `i18n.hi` (a full Hindi rendition with its own audio). The pipeline writes `data/shorts.json`; the app reads it at build time and falls back to `data/mock-shorts.json`.
- **Global clustering:** all tracks' feeds are pooled, de-duplicated and clustered together, so one story is one cluster across desks and outlets. A cluster's *primary track* is the one whose feeds contributed the most articles (ties go to the more specific desk: politics > india > science > finance > technology > sports > world). Each track takes its top N; short tracks are topped up from stories their feeds also carried.
- **Script safety rails** (`pipeline/script.ts`):
  - the LLM only gets headlines plus ≤450-char RSS snippets (one block per outlet), and is told to write original narration;
  - **originality guard:** rejects any 8-word run copied from a source or >12% shared 5-grams; the rejection quotes the offending phrase back to the model, up to 3 attempts, then the offline writer;
  - **number grounding:** on-screen figures, charts and comparisons are dropped unless every number appears in the source text;
  - zod schema validation and a word-count window;
  - **story check:** the writer must name any outlet whose article is about a *different* event (automatic clustering can merge loosely related headlines); those outlets are dropped from sources and the comparison, and their facts aren't used;
  - **coverage comparison:** per outlet an `angle` and a 2–4 word `emphasis`, plus a one-sentence `agreement` and `differences` for the whole story, based only on the per-outlet snippets. Politics prompts enforce neutral framing and attribution.
- **Hindi** (`pipeline/translate.ts`, India track by default): the LLM adapts *our own* English script (never the source articles) into spoken Devanagari, numbers written as Hindi words so the voice reads them correctly. Validation: same segment count, ≥80% Devanagari letters, sane length. Visuals are translated for text labels only: kind, numbers, chart values and map coordinates are pinned to the grounded originals.
- **Narration** (`pipeline/narrate.ts`): cache lookup by content hash (text + language + voice + engine) → synthesise segment by segment (Kokoro) → trim silence, add 0.14 s sentence / 0.32 s segment gaps, peak-normalise → MP3 48 kbps (ffmpeg) → publish to the store → Whisper → word timings. Hindi G2P uses the system `espeak-ng` and then the same Kokoro model with a Hindi voice (the JS `phonemizer` package only ships English voices).
- **Player:** `usePlayback` has one clock and three engines: pre-rendered audio (`neural`), device Web Speech (`device`, one segment at a time, with the right `lang`) and captions-only (`silent`). `buildTimeline` uses `audio.wordTimes` when present (segment start = just before its first word) and falls back to the v1 estimate. `visualCues` derives from the same timings *when parts of a visual react*: headline words light up as the narrator says them, count-ups land on the spoken figure, bars and timeline items reveal in sequence. All scenes are pure functions of time, which is also what makes frame-exact export possible.
- **Visuals:** kinetic headline, count-up number, bar chart, compare, timeline, and an orthographic globe (d3-geo + Natural Earth `world-atlas`) that spins to the story location. Backgrounds are generative per-story colour fields plus grain (CSS only). No publisher photos.

---

## 3. Setup & running locally

Requirements: **Node 22+**, npm, **ffmpeg** (MP3 encoding, Whisper input, video export) and **espeak-ng** (Hindi only: `sudo apt-get install espeak-ng` / `brew install espeak-ng`).

```bash
npm install
cp .env.example .env        # add GROQ_API_KEY (optional — the app runs on the bundled dataset without it)
npm run dev                 # http://localhost:3000
```

Pipeline:

```bash
npm run pipeline                       # feeds → clusters → scripts (Groq) → Hindi → Kokoro → Whisper timings → data/shorts.json
npm run pipeline -- --no-tts           # scripts only
npm run pipeline -- --tracks=tech,india --max=2
npm run pipeline -- --fresh            # ignore cached scripts (<72 h) and rewrite
npm run pipeline -- --renarrate        # re-synthesise audio even where a cached file exists
npm run pipeline:mock                  # offline writer, no LLM calls (narration still runs locally)
EMBED=0 npm run pipeline               # force the lexical clustering fallback
```

First run downloads ≈115 MB of model weights into `pipeline/.cache/models` (git-ignored). A full 21-short run takes ~25 min on 4 cores; re-runs only narrate what changed.

Export a short as a vertical MP4:

```bash
npm run export:video -- --list
npm run export:video -- technology-17t5szl                 # → exports/technology-17t5szl.mp4 + .txt (post caption)
npm run export:video -- india-xobzuy --lang=hi --fps=30
```

Quality gates: `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run build`. Other scripts: `npm run icons`, `npm run screenshots`.

> **Proxy note:** Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). The npm pipeline scripts set it; it is harmless when there is no proxy.

### Environment variables

| Variable | Required | Where to get it | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | recommended | <https://console.groq.com/keys> (free) | Script writer (`openai/gpt-oss-120b`), Hindi adaptation, Whisper word timings |
| `GROQ_MODEL` | no | — | Comma-separated preference list; default `openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `LLM_PROVIDER` | no | — | `auto` (Groq, then Gemini if a key is set), `groq`, `gemini`, `mock` |
| `GEMINI_API_KEY` | **no (optional)** | <https://aistudio.google.com/apikey> | Optional extra LLM / TTS fallback |
| `TTS_PROVIDERS` | no | — | Order, default `kokoro,gemini`. Gemini only joins if a key is set |
| `KOKORO_VOICE_EN` / `KOKORO_VOICE_HI` / `KOKORO_SPEED` | no | — | Defaults `af_heart` / `hf_alpha` / `1` |
| `NARRATE_BUDGET_MIN` | no | — | Stop narrating after N minutes; the rest is picked up next run. CI uses 45 |
| `ALIGN_ENGINES` | no | — | `groq,local` (default). Without `GROQ_API_KEY` local Whisper is used, then segment-level timing |
| `EMBED` / `EMBED_THRESHOLD` / `EMBED_MODEL` | no | — | `EMBED=0` disables embeddings; threshold default `0.6`; model default `Xenova/all-MiniLM-L6-v2` |
| `HINDI_TRACKS` | no | — | Tracks that also get a Hindi version, default `india` |
| `PIPELINE_MAX_STORIES_PER_TRACK` | no | — | default 4 |
| `MODEL_CACHE_DIR` | no | — | Where weights are cached, default `pipeline/.cache/models` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AUDIO_PUBLIC_URL`, `S3_REGION`, `S3_PREFIX` | no | your bucket provider | Object storage for audio; if all five required ones are set, audio is uploaded instead of committed |
| `NEXT_PUBLIC_REPO_URL` | no | — | Shows a link to the *Export MP4* workflow in the story sheet |
| `NEWS_SHORTS_DATA` | no | — | `mock` forces the app onto `data/mock-shorts.json` |

No keys at all? The app still runs on the bundled dataset, and `npm run pipeline` still works: the offline writer produces link-out cards, Kokoro narrates them locally and local Whisper aligns them.

---

## 4. Deploying (free tiers)

**App — Vercel Hobby (recommended):** import the repo, framework preset Next.js, no env vars needed at build. Every push to `main` redeploys. Netlify or Cloudflare Pages also work: every route is prerendered statically.

**Scheduled pipeline — GitHub Actions** (`.github/workflows/pipeline.yml`, every 8 hours and on demand):
1. Settings → Secrets and variables → Actions → add `GROQ_API_KEY` (and the S3 secrets if you use object storage).
2. Settings → Actions → General → Workflow permissions → **Read and write**.
3. The job installs `espeak-ng` + `ffmpeg`, restores the model and embedding caches, runs the pipeline with a 45-minute narration budget and commits `data/shorts.json` (+ `public/audio` in local mode) to the default branch, which triggers a redeploy.

Budget: a cold run (every short new) is ~35–40 min on a 2-core runner; steady-state runs are much shorter because scripts are reused for 72 h and narration is cached by content hash. Public repos have unlimited Actions minutes; a private repo at 3 runs/day uses roughly 1,650 of the 2,000 free minutes.

**Export a video** from the Actions tab: *Export MP4* → enter the short's id (and `hi` for Hindi) → download the artifact. Or run `npm run export:video` locally.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on PRs.

### Moving audio out of git (free object storage)

The default stores MP3s in `public/audio` and commits them. That works with zero setup, but repo history grows by roughly 12–15 MB per fully refreshed day. For a lean repo use any S3-compatible bucket. **Cloudflare R2** is the recommended free option (10 GB storage, free egress, S3 API; verify current limits on Cloudflare's pricing page):

1. Cloudflare dashboard → **R2** → *Create bucket* (e.g. `news-shorts-audio`).
2. Bucket → *Settings* → *Public access* → enable the **r2.dev subdomain** (or attach a custom domain). Copy the public base URL, e.g. `https://pub-xxxxxxxx.r2.dev`.
3. R2 → *Manage API tokens* → *Create API token* with **Object Read & Write** on that bucket. Note the Access Key ID, Secret Access Key and your account's S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Set (in `.env` locally and as Actions secrets): `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AUDIO_PUBLIC_URL` (`S3_REGION=auto` is the default).
5. Run `npm run pipeline`. New narration is uploaded to `audio/<hash>.mp3`; existing local files referenced by `shorts.json` are uploaded and their `src` rewritten to the bucket URL. After that you can `git rm -r public/audio`.

Other S3-compatible options work with the same variables (Backblaze B2, Supabase Storage's S3 endpoint, MinIO). The signer is a small hand-written AWS SigV4 implementation verified against the worked example in the AWS docs, so there is no AWS SDK dependency. Not verified against a live bucket in this repo (no credentials available); see §7. Remote audio isn't added to the PWA's offline cache (cross-origin), only the app shell, feed and local audio are.

---

## 5. Known issues & limitations

- **Narration speed on small runners:** Kokoro is ~1.8× realtime on 4 cores and slower on 2. The time budget makes this incremental rather than failing, but a cold start spans two runs.
- **Voice quality:** Kokoro is good but audibly synthetic; Hindi is graded lower than English by its authors. The Gemini provider (optional) sounds better when quota is available.
- **Hindi timing:** Whisper normalises Hindi spellings (nukta, conjuncts), so typically 70–95% of words match (one clip in testing only 43%); the rest are interpolated inside their exact segment window, which keeps error small. Hindi stories are also long (≈100 s). Hindi script quality is whatever the free LLM produces: read before posting.
- **LLM factual slips:** numbers on screen are grounded, but descriptive details in the narration are not machine-checked (e.g. a wrong job title for a public figure). Every short shows its sources and an "AI can make mistakes" note.
- **Partial runs:** `--tracks=x` keeps the other tracks' shorts from the previous feed, but clusters are built only from the chosen tracks' feeds, so the picks can differ from a full run.
- **Clustering is still imperfect.** Many stories are single-outlet because feeds simply don't overlap. At 0.60 a few loosely related items merge; tune `EMBED_THRESHOLD`.
- **Originality guard vs. the LLM:** some stories need all 3 attempts and a few fall back to the offline writer (shown as "offline"; they're rewritten on the next run and are never narrated).
- **Video export takes ~5 min for a 64 s short at 30 fps** on 4 CPU cores (≈0.16 s per 1080×1920 frame, measured: 313 s). Rasterisation is the cost, so extra parallel pages did not help (`--workers` is there for bigger machines). Use `--fps=24` for drafts. The render view swaps blur and blend effects for look-alike cheap paints, so exports are a touch flatter than the app.
- **Web Speech quality varies by device**, and iOS Safari's `speechSynthesis.pause()` is unreliable (pause cancels and the segment restarts on resume). Autoplay needs one tap before sound.
- **No UI localisation:** only the story text, narration and a few card labels switch to Hindi; the app chrome stays English.
- Some feeds block bots or rate-limit (CNBC 403, Phys.org 429 were replaced with NPR). Failing feeds are logged and skipped.

---

## 6. Decisions

**From v1**
- **Branch:** the brief asked for `claude/v1`; this cloud session can only push to `claude/news-shorts-pwa-bs4t1d`, so all work (v1 and v2) is on that branch and the PR targets `main`.
- **Next.js 16 + React 19 + TypeScript 6**, ESLint 9 flat config, Vitest 5; all pages prerender statically from the JSON dataset.
- **Fonts self-hosted** via `@fontsource` (Bricolage Grotesque, JetBrains Mono, now also Noto Sans Devanagari) so builds need no font network access and the PWA works offline.
- **Design direction** (after vibrant.design): near-black canvas, one saturated two-colour gradient identity per track, heavy condensed grotesque for kinetic type, mono for metadata, karaoke caption pill in the track accent.
- **Catch me up in 3 minutes** plays the first 4 beats of each story, leading with the top story of each chosen track. A "Full story" button continues the current short.
- **No accounts:** tracks, saved, seen and preferences live in `localStorage`.

**New in v2**
- **Nothing depends on Gemini.** Groq is the default LLM, Kokoro the default voice, MiniLM the embedder, Whisper (Groq or local) the aligner. Gemini remains an optional LLM/TTS provider behind the same interfaces.
- **Kokoro voices:** `af_heart` (English; the highest-graded voice) and `hf_alpha` (Hindi). All four Hindi voices scored the same on the Whisper round-trip (38–39 of 41 words), so the choice is a consistent female voice. One voice per language keeps the brand consistent.
- **Per-segment synthesis** (not one big call): exact segment boundaries for free, bounded token lengths, and a hard guarantee that timing errors can't accumulate.
- **Fixed v1 bug:** the Gemini TTS prefix ("Read this as a warm, clear, upbeat news presenter…") was *spoken aloud* at the start of every Gemini narration. It was found by running Whisper over the audio. The Gemini provider now sends the plain text only; the old audio is gone from the dataset.
- **Clustering threshold 0.60, average linkage, max 14 per cluster:** see §1.4.
- **Track assignment by feed votes** instead of per-track clustering, so a story carried by BBC World, the Guardian's politics desk and NPR becomes one multi-outlet short (not three single-outlet ones).
- **LLM story check on top of clustering:** embeddings at 0.60 occasionally merge two different events on the same topic. In the first refresh, "Trump blames Iran war for losses" and "Hegseth's future…" were merged and the "agreement" sentence papered over it. Rather than raise the threshold (losing real multi-outlet stories), the writer now flags unrelated outlets in the same call, at no extra cost.
- **Coverage view:** per-outlet `angle` + `emphasis` label + the outlet's own headline link, a "where they agree" card and a "where they differ" card. We deliberately do **not** attach political-lean labels to outlets (contested; would need a third-party rating source).
- **Hindi is adapted from our English script**, not from the articles, so the originality guarantees carry over; only the India track by default (`HINDI_TRACKS`).
- **Narration priority = rank within track** (lead stories first, English before Hindi at equal rank), then the time budget cuts off the tail. Lead stories are exactly what every "catch me up" playlist starts with.
- **Scripts are reused for 72 h** (stable cluster ids anchored on the oldest article) so audio caches stay valid, and are rewritten sooner only if new outlets joined a story that has no audio yet.
- **Offline-writer placeholders are never narrated.**
- **Video export by deterministic frame rendering** rather than Remotion (licence + weight) or a second renderer.
- **Audio storage:** an `AudioStore` abstraction with `local` (default, committed) and `s3` implementations; one env switch.

---

## 7. Blockers & workarounds

| What failed | What I tried | Outcome / what you need to do |
|---|---|---|
| Gemini quota exhausted (text 429s, embeddings 429, TTS 429) | Retried once as instructed; checked other models | Removed every hard dependency; Gemini is optional. **Nothing needed.** |
| Groq Orpheus TTS: `model_terms_required` | Called the API directly | Not integrated. **You:** an org admin can accept the terms at `console.groq.com/playground?model=canopylabs/orpheus-v1-english` if you want it as another voice. |
| Kokoro ONNX exposes no per-token durations, so no native word timestamps | Inspected the session outputs; considered the Python package (needs PyTorch) | Per-segment exact boundaries + Whisper word alignment (Groq, then local). |
| `phonemizer` (kokoro-js's G2P) only supports English | Tried `hi`; looked for an npm build with all espeak voices | Hindi uses the system `espeak-ng` binary. `apt-get install espeak-ng` worked in the sandbox and is in the Actions workflow. |
| Node `fetch` ignored the sandbox proxy (HTTP 403 on feeds, HF) | Read the proxy docs | `NODE_USE_ENV_PROXY=1` in the npm scripts. Nothing needed elsewhere. |
| S3/R2 upload **not tested against a real bucket** | Implemented SigV4, verified it against the AWS docs' worked example; unit-tested the PUT with a mocked `fetch` | **You:** create a bucket (§4), set the five env vars, run once, and check that one MP3 plays from the bucket URL. |
| GitHub Actions workflows **not run** | Validated YAML; reproduced each step in a clean clone (see Progress) | Workflows can only be dispatched once they're on the default branch. **You:** merge, add `GROQ_API_KEY`, set workflow permissions to read/write, press *Run workflow*. |
| Export was ~0.8 s/frame at first | Profiled: Playwright screenshot overhead, then software rasterisation of big blurred/blended layers. Tried DevTools capture (4× faster but only at CSS pixels unless clipped at 2×), 4 parallel workers (no gain), cheaper paints in the render view (−45%) | ~0.16 s/frame: a 64 s short exports in ~5 min. Nothing needed. |

---

## 8. Progress

### Done
- **v1:** RSS ingest, clustering, Groq/Gemini script writer with originality + number guards, swipe feed, three narration engines, karaoke captions, six generated visuals, track picker, catch-up playlist, save/share, PWA, mock dataset, CI.
- **v2:**
  1. **Narration with no quota:** Kokoro-82M local TTS (en + hi) is the primary voice; every short is narrated; audio is cached by content hash across runs; lead stories first; optional time budget; Gemini TTS optional.
  2. **Exact captions:** per-segment synthesis + Whisper word timings drive captions *and* kinetic text (spoken-word highlights, count-up landing on the spoken figure, sequenced reveals). Groq Whisper → local Whisper → segment-level fallback.
  3. **Embedding clustering** with a local MiniLM model (lexical fallback), global across tracks; **new coverage view** (agree / differ cards, per-outlet emphasis + headline link, tappable "N outlets" chip).
  4. **Hindi** for the India track: Groq adaptation of our script + Kokoro Hindi voice; per-user language switch (card pill and tracks sheet); Devanagari font self-hosted; device voice uses `hi-IN`.
  5. **MP4 export:** `npm run export:video` and an Actions workflow; also writes a post caption with source credits.
  6. **Dataset refreshed:** 21 shorts (all 21 written by Groq and narrated by Kokoro, all with Whisper-aligned word timings; 3 India stories also in Hindi with their own narration; 19 of 21 cite 2+ outlets and 18 carry an agree/differ comparison). It was produced by a full run and then an incremental run that reused 16 shorts straight from cache; screenshots updated.
  7. **Storage:** `AudioStore` (local/git or S3-compatible), SigV4 signer, upload-and-rewrite migration, documented R2 setup.
- **Tests:** 88 vitest tests (RSS, clustering incl. semantic + picks, embedding cache, script guards, alignment, timeline + cues, playlist, LLM fallback and retry-after, TTS text/audio utils, storage + SigV4 vector, narration cache, Hindi validation and localisation). Typecheck, lint and production build are clean.
- **Clean-room check:** fresh `git clone` of this branch → `npm ci` → typecheck, lint, 88 tests, build → `pipeline/run.ts --tracks=india,sports --max=1 --fresh` with `GEMINI_API_KEY` removed from the environment and an empty model cache: weights downloaded on first use, Groq wrote 2 scripts + 1 Hindi adaptation, Kokoro narrated 3 clips, Whisper aligned all of them, other tracks were kept. This mirrors what the Actions job does (same Node 22, `espeak-ng` + `ffmpeg` from apt).

### In progress
- Nothing. Pick up from "Next".

### Next (roadmap)
1. Word-level timings for the device voice (Web Speech `boundary` events are used today; they are coarse on some platforms).
2. More Kokoro languages (Spanish, French, Portuguese, Japanese, Chinese voices exist) as extra `i18n` renditions; needs per-language G2P and translation prompts.
3. Stronger clustering evidence: combine embedding similarity with named-entity overlap; learn the threshold per track.
4. In-app "Export" via a tiny serverless function (the exporter currently needs Node + Chromium).
5. Push notifications for breaking stories; "seen" sync across devices.
6. Cache remote (bucket) audio in the service worker for offline listening.
