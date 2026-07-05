import type { RunCostSummary, TopicResult } from "@mmd/orchestrator";
import type {
  ClassifyCandidateResult,
  Critique,
  FinalAnswer,
  NormalizeResult,
  OutlineResult,
  Phase,
  PlanDocument,
  Proposal,
  QuorumCheck,
  RevisionSet,
  RunMode,
  VoteSet,
} from "@mmd/protocol";

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunRow {
  id: string;
  conversationId: string;
  question: string;
  mode: RunMode;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ModelInfo {
  id: string;
  providerLabel: string;
  isCoordinator: boolean;
}

export interface ProviderInfo {
  providerId: string;
  displayName: string;
  /** M5.1 follow-up: a starting suggestion for this provider's $/1M-token rate — undefined for OpenRouter (reports real cost, nothing to guess) or if we don't have one. */
  suggestedRate?: PricingOverride;
}

/** M5.1 follow-up: a caller-supplied $/1M-token rate, overriding @mmd/protocol's built-in approximate table for this one model. */
export interface PricingOverride {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface SavedApiKeyMetadata {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  pricing?: PricingOverride;
  createdAt: string;
}

// Exactly one of apiKey/savedKeyId, mirroring apps/api's ByokModelEntry —
// either a freshly-entered key (optionally opted into being saved), or a
// reference to a previously-saved one so the browser never re-holds the
// plaintext to reuse it. `pricing` on the savedKeyId variant overrides that
// saved key's own persisted rate for this run only, without changing what's
// stored (re-add with save:true to update the stored rate itself).
export type ByokModelInput =
  | {
      providerId: string;
      modelId: string;
      apiKey: string;
      label?: string;
      save?: boolean;
      pricing?: PricingOverride;
    }
  | { savedKeyId: string; label?: string; pricing?: PricingOverride };

// Mirrors apps/api/src/repositories/results-repo.ts's getResult() shape plus
// the runId/question/mode/status the route adds on top — not DeliberationResult
// itself, which also carries a `budget` field getResult never persists.
export interface RunResult {
  runId: string;
  question: string;
  mode: RunMode;
  status: "completed";
  proposals: Proposal[];
  critiques: Critique[];
  revisions: RevisionSet[];
  normalize: NormalizeResult;
  votes: VoteSet[];
  classifications: Record<string, ClassifyCandidateResult>;
  final: FinalAnswer;
  outline?: OutlineResult;
  topics?: TopicResult[];
  planDocument?: PlanDocument;
  timings: Partial<Record<Phase, number>>;
  quorum: Partial<Record<Phase, QuorumCheck>>;
  cost?: RunCostSummary;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  const body = await asJson<{ conversations: ConversationSummary[] }>(res);
  return body.conversations;
}

export async function createConversation(
  title?: string
): Promise<ConversationSummary> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  return asJson<ConversationSummary>(res);
}

export async function getConversation(
  id: string
): Promise<ConversationSummary & { runs: RunRow[] }> {
  const res = await fetch(`/api/conversations/${id}`);
  return asJson<ConversationSummary & { runs: RunRow[] }>(res);
}

export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  const body = await asJson<{ models: ModelInfo[] }>(res);
  return body.models;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const res = await fetch("/api/providers");
  const body = await asJson<{ providers: ProviderInfo[] }>(res);
  return body.providers;
}

export async function listWorkspaceKeys(): Promise<SavedApiKeyMetadata[]> {
  const res = await fetch("/api/workspace/keys");
  const body = await asJson<{ keys: SavedApiKeyMetadata[] }>(res);
  return body.keys;
}

export async function createRun(
  conversationId: string,
  params: {
    question: string;
    mode: RunMode;
    modelIds?: string[];
    byokModels?: ByokModelInput[];
    costLimitUsd?: number;
  }
): Promise<{ runId: string; status: RunStatus }> {
  const res = await fetch(`/api/conversations/${conversationId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return asJson<{ runId: string; status: RunStatus }>(res);
}

export async function getRun(id: string): Promise<RunRow> {
  const res = await fetch(`/api/runs/${id}`);
  return asJson<RunRow>(res);
}

export async function getRunResult(id: string): Promise<RunResult> {
  const res = await fetch(`/api/runs/${id}/result`);
  return asJson<RunResult>(res);
}

// M5.5: idempotent — returns the same token if this run was already shared.
export async function createShareLink(runId: string): Promise<{ token: string }> {
  const res = await fetch(`/api/runs/${runId}/share`, { method: "POST" });
  return asJson<{ token: string }>(res);
}

export async function revokeShareLink(runId: string): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/share`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }
}

// The public, cookie-free read path (see apps/api/src/routes/share.ts) —
// same response shape as getRunResult, fetched by token instead of runId/an
// authenticated workspace.
export async function getSharedRun(token: string): Promise<RunResult> {
  const res = await fetch(`/api/share/${token}`);
  return asJson<RunResult>(res);
}
