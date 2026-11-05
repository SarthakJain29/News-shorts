import path from "node:path";
import { env as hfEnv } from "@huggingface/transformers";

let configured = false;

/** Point transformers.js at a repo-local, git-ignored cache so CI can persist model weights between runs. */
export function configureModels(env: Record<string, string | undefined> = process.env): typeof hfEnv {
  if (!configured) {
    hfEnv.cacheDir = env.MODEL_CACHE_DIR || path.join(process.cwd(), "pipeline", ".cache", "models");
    hfEnv.allowLocalModels = false;
    configured = true;
  }
  return hfEnv;
}
