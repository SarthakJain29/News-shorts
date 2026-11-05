export interface LlmRequest {
  system: string;
  user: string;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
}

export interface LlmProvider {
  name: "gemini" | "groq" | "mock";
  model: string;
  available(): boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}
export type Env = Record<string, string | undefined>;
