export interface WebhookConfig {
  isProduction: boolean;
  webhookUrl?: string;
  secretToken?: string;
}

/**
 * Ensures the webhook URL points to the '/webhook' path.
 * Strips trailing slashes and appends '/webhook' if not already present.
 */
export function resolveWebhookUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/webhook") ? trimmed : `${trimmed}/webhook`;
}

/**
 * Validates webhook configuration based on the execution environment.
 * When NODE_ENV=production, enforces HTTPS WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET.
 */
export function validateWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  const isProduction = env.NODE_ENV === "production";

  if (!isProduction) {
    if (env.WEBHOOK_URL && env.WEBHOOK_URL.trim()) {
      return {
        isProduction: false,
        webhookUrl: resolveWebhookUrl(env.WEBHOOK_URL),
        secretToken: env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
      };
    }
    return {
      isProduction: false,
    };
  }

  // Production environment validation
  const rawUrl = env.WEBHOOK_URL?.trim();
  if (!rawUrl) {
    throw new Error(
      "CRITICAL WEBHOOK CONFIGURATION ERROR: WEBHOOK_URL is required when NODE_ENV=production."
    );
  }

  if (!rawUrl.startsWith("https://")) {
    throw new Error(
      "CRITICAL WEBHOOK CONFIGURATION ERROR: WEBHOOK_URL must use HTTPS protocol in production."
    );
  }

  const secretToken = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secretToken) {
    throw new Error(
      "CRITICAL WEBHOOK CONFIGURATION ERROR: TELEGRAM_WEBHOOK_SECRET is required when NODE_ENV=production to validate Telegram updates against spoofing."
    );
  }

  // Telegram secret_token rules: 1-256 characters, only [A-Za-z0-9_-]
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secretToken)) {
    throw new Error(
      "CRITICAL WEBHOOK CONFIGURATION ERROR: TELEGRAM_WEBHOOK_SECRET must contain only 1-256 alphanumeric characters, underscores, or dashes ([A-Za-z0-9_-])."
    );
  }

  return {
    isProduction: true,
    webhookUrl: resolveWebhookUrl(rawUrl),
    secretToken,
  };
}
