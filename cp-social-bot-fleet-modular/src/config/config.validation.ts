// ============================================================
// CONFIGURATION VALIDATION
// ============================================================
// Fail-fast: if critical env vars are missing, the app refuses
// to start. This prevents running with misconfigured state —
// a key CP design principle (prefer failure over inconsistency).
// ============================================================

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const required = ['DATABASE_URL', 'ENCRYPTION_KEY'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `The application cannot start without these. ` +
        `Copy .env.example to .env and fill in values.`,
    );
  }

  // Validate encryption key length (at least 32 chars)
  const encKey = config['ENCRYPTION_KEY'] as string;
  if (encKey && encKey.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY must be at least 32 characters (64 hex recommended). ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  return config;
}
