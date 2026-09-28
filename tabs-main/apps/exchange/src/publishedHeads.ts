import { compareSemverVersions } from "@tabs/shared/semver";
import type { PoolClient } from "pg";

export interface PublishedTarget {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
}

export function publishedHeads(
  targets: readonly PublishedTarget[],
): ReadonlyArray<PublishedTarget> {
  const heads = new Map<string, PublishedTarget>();
  for (const target of targets) {
    const identity = `${target.namespace}.${target.name}`;
    const current = heads.get(identity);
    if (!current || compareSemverVersions(target.version, current.version) > 0) {
      heads.set(identity, target);
    }
  }
  return [...heads.values()];
}

/** Call inside a transaction holding the signed-publication advisory lock. */
export async function refreshPublishedHead(
  client: PoolClient,
  namespace: string,
  name: string,
): Promise<void> {
  const approved = await client.query<PublishedTarget>(
    `SELECT v.namespace, v.name, v.version, v.digest, v.bytes
     FROM exchange_versions v JOIN exchange_published_targets p
       ON p.namespace = v.namespace AND p.name = v.name AND p.version = v.version
       AND p.digest = v.digest AND p.bytes = v.bytes
     WHERE v.namespace = $1 AND v.name = $2 AND v.status = 'approved'`,
    [namespace, name],
  );
  const head = publishedHeads(approved.rows)[0];
  await client.query("DELETE FROM exchange_published_heads WHERE namespace = $1 AND name = $2", [
    namespace,
    name,
  ]);
  if (head) {
    await client.query(
      `INSERT INTO exchange_published_heads(namespace, name, version)
       VALUES ($1, $2, $3)`,
      [namespace, name, head.version],
    );
  }
}
