import type { TopicResult } from "@mmd/orchestrator";
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
}

export interface SavedApiKeyMetadata {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  createdAt: string;
}

// Exactly one of apiKey/savedKeyId, mirroring apps/api's ByokModelEntry —
// either a freshly-entered key (optionally opted into being saved), or a
// reference to a previously-saved one so the browser never re-holds the
// plaintext to reuse it.
export type ByokModelInput =
  | {
      providerId: string;
      modelId: string;
      apiKey: string;
      label?: string;
      save?: boolean;
    }
  | { savedKeyId: string; label?: string };

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
