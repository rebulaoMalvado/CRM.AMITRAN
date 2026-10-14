import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { llmOutputSchema } from "./guards.js";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export type LlmErrorKind = "auth" | "billing" | "rate_limit" | "other";

export class LlmError extends Error {
  constructor(
    message: string,
    public kind: LlmErrorKind,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmResult {
  /** Saída já no formato pedido (ainda será validada por sanitizeOutput). null = não veio no formato. */
  output: unknown;
  /** A IA recusou por política de segurança. */
  refusal: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Contrato da IA. O resto do sistema só conhece ESTA interface: para trocar de fornecedor
 * (ou de modelo) basta outra implementação — nada mais muda.
 */
export interface LlmProvider {
  generate(input: { system: string; messages: LlmMessage[] }): Promise<LlmResult>;
}

/** Só alguns modelos aceitam o parâmetro "effort" (nível de esforço de raciocínio). */
const supportsEffort = (model: string) => /sonnet-5|opus-5|opus-4-[678]|fable|mythos/.test(model);

export function createAnthropicProvider(config: { apiKey: string; model: string }): LlmProvider {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 60_000 });

  return {
    async generate({ system, messages }) {
      try {
        const response = await client.messages.parse({
          model: config.model,
          max_tokens: 1500,
          system,
          messages,
          output_config: {
            ...(supportsEffort(config.model) ? { effort: "low" as const } : {}),
            format: zodOutputFormat(llmOutputSchema),
          },
        });
        return {
          output: response.parsed_output ?? null,
          refusal: response.stop_reason === "refusal",
          model: response.model,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        };
      } catch (err) {
        throw classify(err);
      }
    },
  };
}

function classify(err: unknown): LlmError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError("Chave da IA inválida ou sem permissão", "auth");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError("Limite de uso da IA atingido, tente mais tarde", "rate_limit");
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance|billing/i.test(err.message)) {
    return new LlmError("Sem saldo na conta da IA", "billing");
  }
  const status = err instanceof Anthropic.APIError ? ` (HTTP ${err.status})` : "";
  return new LlmError(`Falha ao consultar a IA${status}`, "other");
}
