import type { Kysely, Selectable } from "kysely";
import { decryptApiKey, encryptApiKey } from "../crypto/key-encryption.js";
import type { Database, WorkspaceApiKeysTable } from "../db/client.js";

export interface SavedApiKeyMetadata {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  createdAt: string;
}

export interface DecryptedApiKey {
  providerId: string;
  modelId: string;
  label: string | null;
  apiKey: string;
}

/** Upserts on (workspace_id, provider_id, model_id) — saving again for the same model replaces the stored key/label. */
export async function saveApiKey(
  db: Kysely<Database>,
  encryptionKey: Buffer,
  params: {
    workspaceId: string;
    providerId: string;
    modelId: string;
    apiKey: string;
    label?: string;
  }
): Promise<SavedApiKeyMetadata> {
  const encrypted = encryptApiKey(params.apiKey, encryptionKey);
  const row = await db
    .insertInto("workspace_api_keys")
    .values({
      workspace_id: params.workspaceId,
      provider_id: params.providerId,
      model_id: params.modelId,
      label: params.label ?? null,
      encrypted_key: encrypted,
    })
    .onConflict((oc) =>
      oc.columns(["workspace_id", "provider_id", "model_id"]).doUpdateSet({
        encrypted_key: encrypted,
        label: params.label ?? null,
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
    createdAt: row.created_at.toISOString(),
  };
}
