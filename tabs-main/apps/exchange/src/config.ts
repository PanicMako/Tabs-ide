import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
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
  readonly visibility?: "public" | "private";
  readonly allowedGithubIds?: ReadonlySet<string>;
  readonly testGithubAuthUrls?: {
    readonly authorizeUrl: string;
    readonly tokenUrl: string;
    readonly userUrl: string;
  };
}

export function loadConfig(): ExchangeConfig {
  const operatorGithubIds = new Set(
    (process.env.EXCHANGE_OPERATOR_GITHUB_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if ([...operatorGithubIds].some((id) => !/^[1-9][0-9]*$/.test(id)))
    throw new Error("Operator accounts require numeric GitHub IDs.");
  const origin = new URL(required("EXCHANGE_ORIGIN"));
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("EXCHANGE_ORIGIN must be an origin without a path.");
  }
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("EXCHANGE_ORIGIN must use HTTPS outside localhost.");
  }
  const visibility = process.env.EXCHANGE_VISIBILITY ?? "public";
  if (visibility !== "public" && visibility !== "private")
    throw new Error("EXCHANGE_VISIBILITY must be public or private.");
  const allowedGithubIds = new Set(
    (process.env.EXCHANGE_ALLOWED_GITHUB_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (
    visibility === "private" &&
    (!allowedGithubIds.size || [...allowedGithubIds].some((id) => !/^[1-9][0-9]*$/.test(id)))
  )
    throw new Error("Private Exchange requires an explicit GitHub numeric ID allowlist.");
  return {
    origin: origin.origin,
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    adminGithubIds: new Set(required("EXCHANGE_ADMIN_GITHUB_IDS").split(",")),
    operatorGithubIds,
    bucket: required("S3_BUCKET"),
    publishingEnabled: process.env.EXCHANGE_PUBLISHING_ENABLED === "true",
    visibility,
    allowedGithubIds,
  };
}

export function createPool(): Pool {
  return new Pool({ connectionString: required("DATABASE_URL"), max: 10 });
}

export function createStorage(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: required("S3_ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
}
