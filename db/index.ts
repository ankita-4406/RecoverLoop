import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RecoverLoopBindings = {
  DB?: D1Database;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TIMEOUT_MS?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
};

function getBindings(): RecoverLoopBindings {
  return env as unknown as RecoverLoopBindings;
}

export function getD1Database(): D1Database {
  const database = getBindings().DB;

  if (!database) {
    throw new Error("Required database binding is unavailable");
  }

  return database;
}

export function getRazorpayWebhookSecret(): string {
  const secret = getBindings().RAZORPAY_WEBHOOK_SECRET;

  if (!secret || !secret.trim()) {
    throw new Error("Required webhook secret is unavailable");
  }

  return secret;
}

export function getOpenAIPlannerConfig(): {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
} {
  const bindings = getBindings();
  const apiKey = bindings.OPENAI_API_KEY?.trim();
  const model = bindings.OPENAI_MODEL?.trim();
  const parsedTimeout = bindings.OPENAI_TIMEOUT_MS?.trim()
    ? Number(bindings.OPENAI_TIMEOUT_MS)
    : Number.NaN;

  return {
    apiKey: apiKey || undefined,
    model: model || undefined,
    timeoutMs: Number.isFinite(parsedTimeout) ? parsedTimeout : undefined,
  };
}

export function getDb() {
  return drizzle(getD1Database(), { schema });
}
