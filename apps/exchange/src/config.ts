import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

function required(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value) throw new Error(`Missing ${fallback ? `${name} or ${fallback}` : name}.`);
  return value;
}

export interface ExchangeConfig {
  readonly origin: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly adminGithubIds: ReadonlySet<string>;
  readonly operatorGithubIds?: ReadonlySet<string>;
  readonly bucket: string;
  readonly publishingEnabled: boolean;
  readonly namespaceManagementEnabled?: boolean;
  readonly visibility?: "public" | "private";
  readonly allowedGithubIds?: ReadonlySet<string>;
  readonly testGithubAuthUrls?: {
    readonly authorizeUrl: string;
    readonly tokenUrl: string;
    readonly userUrl: string;
  };
}

function githubIds(name: string): ReadonlySet<string> {
  const ids = new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if ([...ids].some((id) => !/^[1-9][0-9]*$/.test(id)))
    throw new Error(`${name} requires numeric GitHub IDs.`);
  return ids;
}

export function loadConfig(): ExchangeConfig {
  const operatorGithubIds = githubIds("EXCHANGE_OPERATOR_GITHUB_IDS");
  const adminGithubIds = githubIds("EXCHANGE_ADMIN_GITHUB_IDS");
  const origin = new URL(required("EXCHANGE_ORIGIN"));
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error("EXCHANGE_ORIGIN must be an origin without a path.");
  }
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && origin.hostname === "localhost")
  ) {
    throw new Error("EXCHANGE_ORIGIN must use HTTPS outside localhost.");
  }
  const visibility = process.env.EXCHANGE_VISIBILITY ?? "public";
  if (visibility !== "public" && visibility !== "private")
    throw new Error("EXCHANGE_VISIBILITY must be public or private.");
  const allowedGithubIds = githubIds("EXCHANGE_ALLOWED_GITHUB_IDS");
  if (visibility === "private" && !allowedGithubIds.size)
    throw new Error("Private Exchange requires an explicit GitHub numeric ID allowlist.");
  return {
    origin: origin.origin,
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    adminGithubIds,
    operatorGithubIds,
    bucket: required("S3_BUCKET"),
    publishingEnabled: process.env.EXCHANGE_PUBLISHING_ENABLED === "true",
    namespaceManagementEnabled:
      process.env.EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED === undefined
        ? process.env.EXCHANGE_PUBLISHING_ENABLED === "true"
        : process.env.EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED === "true",
    visibility,
    allowedGithubIds,
  };
}

export function createPool(options: { readonly direct?: boolean } = {}): Pool {
  const connectionString = options.direct
    ? process.env.DATABASE_URL_UNPOOLED || required("DATABASE_URL")
    : required("DATABASE_URL");
  if (options.direct && new URL(connectionString).hostname.includes("-pooler.")) {
    throw new Error(
      "Set DATABASE_URL_UNPOOLED to a direct connection for migrations and notifications.",
    );
  }
  return new Pool({ connectionString, max: options.direct ? 1 : 10 });
}

export function createStorage(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || process.env.AWS_REGION || "auto",
    endpoint: required("S3_ENDPOINT", "AWS_ENDPOINT_URL_S3"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    },
  });
}

/** Account setup is independent of package uploads, with legacy-config fallback. */
export function namespaceManagementEnabled(config: ExchangeConfig): boolean {
  return config.namespaceManagementEnabled ?? config.publishingEnabled;
}
