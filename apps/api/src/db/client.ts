import { Kysely, PostgresDialect, type Generated } from "kysely";
import { Pool } from "pg";

export interface WorkspacesTable {
  id: Generated<string>;
  token: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface WorkspaceApiKeysTable {
  id: Generated<string>;
  workspace_id: string;
  provider_id: string;
  model_id: string;
  label: string | null;
  encrypted_key: Buffer;
  /** M5.1 follow-up: an optional persisted custom $/1M-token rate — both set or both null, see workspace-api-keys-repo.ts. */
  input_per_million: number | null;
  output_per_million: number | null;
  created_at: Generated<Date>;
}

export interface ConversationsTable {
  id: Generated<string>;
  title: string | null;
  workspace_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RunsTable {
  id: string;
  conversation_id: string;
  workspace_id: string | null;
  question: string;
  input_images: unknown;
  mode: string;
  governance: Generated<string>;
  protocol_version: Generated<string>;
  status: string;
  model_config: unknown;
  budget: unknown;
  error: string | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
  share_token: string | null;
}

export interface RunEventsTable {
  id: Generated<string>;
  run_id: string;
  seq: number;
  type: string;
  phase: string | null;
  topic_id: string | null;
  data: unknown;
  created_at: Generated<Date>;
}

export interface ClaimsTable {
  run_id: string;
  claim_id: string;
  model_id: string;
  topic_id: string | null;
  text: string;
  claim_type: string;
  confidence: number | null;
  rationale: string | null;
  payload: unknown;
  created_at: Generated<Date>;
}

export interface ReviewsTable {
  id: Generated<string>;
  run_id: string;
  reviewer_model_id: string;
  target_claim_id: string;
  topic_id: string | null;
  stance: string;
  severity: string;
  comment: string;
  suggested_revision: string | null;
  payload: unknown;
  created_at: Generated<Date>;
}

export interface CandidatesTable {
  run_id: string;
  candidate_id: string;
  topic_id: string | null;
  text: string;
  source_claim_ids: string[];
  notes: string | null;
  classification: unknown;
  payload: unknown;
  created_at: Generated<Date>;
}

export interface VotesTable {
  run_id: string;
  candidate_id: string;
  model_id: string;
  vote: string;
  confidence: number | null;
  reason: string | null;
  objection_severity: string | null;
  payload: unknown;
  created_at: Generated<Date>;
}

export interface RunResultsTable {
  run_id: string;
  proposals: unknown;
  critiques: unknown;
  revisions: unknown;
  normalize: unknown;
  votes: unknown;
  classifications: unknown;
  final_answer: unknown;
  outline: unknown;
  topics: unknown;
  plan_document: unknown;
  timings: unknown;
  quorum: unknown;
  cost: unknown;
  // M6.1 user-defined JSON output — see migrations/0008_output_format.sql.
  output_format: unknown;
  user_output: unknown;
  user_output_error: string | null;
  trace: unknown;
  planning_final: unknown;
  created_at: Generated<Date>;
}

export interface RunTracesTable {
  run_id: string;
  status: string;
  trace: unknown;
  updated_at: Generated<Date>;
}

export interface RunArtifactsTable {
  run_id: string;
  artifact_id: string;
  kind: string;
  phase: string;
  status: string;
  topic_id: string | null;
  candidate_set_id: string | null;
  parent_ids: unknown;
  payload: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  workspaces: WorkspacesTable;
  workspace_api_keys: WorkspaceApiKeysTable;
  conversations: ConversationsTable;
  runs: RunsTable;
  run_events: RunEventsTable;
  claims: ClaimsTable;
  reviews: ReviewsTable;
  candidates: CandidatesTable;
  votes: VotesTable;
  run_results: RunResultsTable;
  run_traces: RunTracesTable;
  run_artifacts: RunArtifactsTable;
}

export function createDb(databaseUrl: string): Kysely<Database> {
  const pool = new Pool({ connectionString: databaseUrl });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
