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

export async function createRun(
  conversationId: string,
  params: { question: string; mode: RunMode; modelIds?: string[] }
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
