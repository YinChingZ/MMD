import type { Kysely, Selectable } from "kysely";
import { decryptApiKey, encryptApiKey } from "../crypto/key-encryption.js";
import type { Database, WorkspaceApiKeysTable } from "../db/client.js";

export interface SavedRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface SavedApiKeyMetadata {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  /** M5.1 follow-up: the custom rate saved alongside this key, if the user provided one. */
  pricing?: SavedRate;
  createdAt: string;
}

export interface DecryptedApiKey {
  providerId: string;
  modelId: string;
  label: string | null;
  apiKey: string;
  pricing?: SavedRate;
}

/** Upserts on (workspace_id, provider_id, model_id) — saving again for the same model replaces the stored key/label/pricing. Passing pricing: undefined clears any previously-saved rate (matches the "replace, not merge" semantics already used for label). */
export async function saveApiKey(
  db: Kysely<Database>,
  encryptionKey: Buffer,
  params: {
    workspaceId: string;
    providerId: string;
    modelId: string;
    apiKey: string;
    label?: string;
    pricing?: SavedRate;
  }
): Promise<SavedApiKeyMetadata> {
  const encrypted = encryptApiKey(params.apiKey, encryptionKey);
  const inputPerMillion = params.pricing?.inputPerMillion ?? null;
  const outputPerMillion = params.pricing?.outputPerMillion ?? null;
  const row = await db
    .insertInto("workspace_api_keys")
    .values({
      workspace_id: params.workspaceId,
      provider_id: params.providerId,
      model_id: params.modelId,
      label: params.label ?? null,
      encrypted_key: encrypted,
      input_per_million: inputPerMillion,
      output_per_million: outputPerMillion,
    })
    .onConflict((oc) =>
      oc.columns(["workspace_id", "provider_id", "model_id"]).doUpdateSet({
        encrypted_key: encrypted,
        label: params.label ?? null,
        input_per_million: inputPerMillion,
        output_per_million: outputPerMillion,
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  return toMetadata(row);
}

/** Metadata only — never returns decrypted (or even encrypted) key material. */
export async function listApiKeysForWorkspace(
  db: Kysely<Database>,
  workspaceId: string
): Promise<SavedApiKeyMetadata[]> {
  const rows = await db
    .selectFrom("workspace_api_keys")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map(toMetadata);
}

/** Scoped to workspaceId so one workspace can never decrypt another's saved key by guessing an id. */
export async function getDecryptedApiKey(
  db: Kysely<Database>,
  encryptionKey: Buffer,
  params: { workspaceId: string; id: string }
): Promise<DecryptedApiKey | undefined> {
  const row = await db
    .selectFrom("workspace_api_keys")
    .selectAll()
    .where("id", "=", params.id)
    .where("workspace_id", "=", params.workspaceId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    label: row.label,
    apiKey: decryptApiKey(row.encrypted_key, encryptionKey),
    pricing: toSavedRate(row),
  };
}

function toSavedRate(
  row: Pick<
    Selectable<WorkspaceApiKeysTable>,
    "input_per_million" | "output_per_million"
  >
): SavedRate | undefined {
  if (row.input_per_million === null || row.output_per_million === null) {
    return undefined;
  }
  return {
    inputPerMillion: row.input_per_million,
    outputPerMillion: row.output_per_million,
  };
}

function toMetadata(
  row: Selectable<WorkspaceApiKeysTable>
): SavedApiKeyMetadata {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    label: row.label,
    pricing: toSavedRate(row),
    createdAt: row.created_at.toISOString(),
  };
}
