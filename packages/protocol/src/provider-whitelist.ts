// BYOK (bring-your-own-key) providers a client may supply their own API key
// for. baseUrl is fixed per provider and never client-suppliable — this is
// what keeps BYOK from reopening the SSRF concern that led M2 to restrict
// model selection to a server-side registry in the first place (see
// docs/protocol.md "M2: Backend API"). Fully custom/arbitrary baseUrl is an
// explicit non-goal here.

export interface ProviderWhitelistEntry {
  providerId: string;
  displayName: string;
  baseUrl: string;
}

export const PROVIDER_WHITELIST: ProviderWhitelistEntry[] = [
  {
    providerId: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    providerId: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    providerId: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    providerId: "volcengine",
    displayName: "Volcengine (Ark)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
];

export function isWhitelistedProvider(providerId: string): boolean {
  return PROVIDER_WHITELIST.some((p) => p.providerId === providerId);
}

export function getProviderBaseUrl(providerId: string): string | undefined {
  return PROVIDER_WHITELIST.find((p) => p.providerId === providerId)?.baseUrl;
}

export function getProviderDisplayName(providerId: string): string | undefined {
  return PROVIDER_WHITELIST.find((p) => p.providerId === providerId)
    ?.displayName;
}
