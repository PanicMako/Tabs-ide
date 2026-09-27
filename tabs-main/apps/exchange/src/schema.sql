CREATE TABLE IF NOT EXISTS exchange_users (
  id BIGINT PRIMARY KEY,
  login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES exchange_users(id),
  csrf_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_namespaces (
  name TEXT PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9-]{1,62}$'),
  verified BOOLEAN NOT NULL DEFAULT false,
  terms_version TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES exchange_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_namespace_members (
  namespace TEXT NOT NULL REFERENCES exchange_namespaces(name),
  user_id BIGINT NOT NULL REFERENCES exchange_users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'contributor')),
  PRIMARY KEY (namespace, user_id)
);

CREATE TABLE IF NOT EXISTS exchange_namespace_verifications (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL REFERENCES exchange_namespaces(name),
  actor_id BIGINT NOT NULL REFERENCES exchange_users(id),
  verified BOOLEAN NOT NULL,
  proof_url TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_versions (
  namespace TEXT NOT NULL REFERENCES exchange_namespaces(name),
  name TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{1,62}$'),
  version TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 26214400),
  manifest JSONB NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'scanning', 'review', 'rejected', 'approved', 'revoked')),
  scan_result JSONB,
  scan_claimed_at TIMESTAMPTZ,
  scan_token UUID,
  uploaded_by BIGINT NOT NULL REFERENCES exchange_users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES exchange_users(id),
  review_reason TEXT,
  PRIMARY KEY (namespace, name, version),
  UNIQUE (namespace, name, digest)
);

CREATE INDEX IF NOT EXISTS exchange_versions_public_search
  ON exchange_versions (namespace, name, submitted_at DESC)
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS exchange_review_events (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES exchange_users(id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'revoke')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (namespace, name, version)
    REFERENCES exchange_versions(namespace, name, version)
);

CREATE TABLE IF NOT EXISTS exchange_appeals (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES exchange_users(id),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response TEXT,
  responded_by BIGINT REFERENCES exchange_users(id),
  responded_at TIMESTAMPTZ,
  FOREIGN KEY (namespace, name, version)
    REFERENCES exchange_versions(namespace, name, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS exchange_appeals_one_open_per_version
  ON exchange_appeals (namespace, name, version) WHERE responded_at IS NULL;

-- Operator-reviewed package or contained-file hashes. Entries are immutable;
-- a correction requires an explicit audited removal before adding a new rule.
CREATE TABLE IF NOT EXISTS exchange_blocked_digests (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  created_by BIGINT NOT NULL REFERENCES exchange_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_blocked_digest_events (
  id BIGSERIAL PRIMARY KEY,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  reason TEXT NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES exchange_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signed TUF bytes are produced offline and published separately from review.
-- API and worker containers never hold metadata signing keys.
CREATE TABLE IF NOT EXISTS exchange_tuf_metadata (
  name TEXT PRIMARY KEY CHECK (name ~ '^([1-9][0-9]*\.)?(root|snapshot|targets)\.json$|^timestamp\.json$'),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) > 0 AND octet_length(bytes) <= 4194304),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derived from the verified targets role in the same publication transaction.
-- Approval alone never makes a package discoverable or downloadable.
CREATE TABLE IF NOT EXISTS exchange_published_targets (
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 26214400),
  PRIMARY KEY (namespace, name, version),
  FOREIGN KEY (namespace, name, version)
    REFERENCES exchange_versions(namespace, name, version)
);
