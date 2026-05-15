import Anthropic from '@anthropic-ai/sdk';

/**
 * Centralised Anthropic client.
 *
 * We route through OpenRouter by default — Taiwanese credit cards
 * cannot pay Anthropic Stripe directly (see project memory
 * feedback_anthropic_via_openrouter). When ANTHROPIC_BASE_URL is set,
 * the SDK transparently proxies. Model IDs must use OpenRouter's
 * `anthropic/claude-sonnet-4.5` format in that case.
 */

const baseURL = process.env.ANTHROPIC_BASE_URL || undefined;
const apiKey = process.env.ANTHROPIC_API_KEY!;

export const anthropic = new Anthropic({ apiKey, baseURL });

export const MODELS = {
  // Primary extraction (Sonnet 4.5)
  primary: process.env.ANTHROPIC_MODEL_PRIMARY || 'anthropic/claude-sonnet-4.5',
  // Cheap fallback / drafts (Haiku 4.5)
  fast: process.env.ANTHROPIC_MODEL_FAST || 'anthropic/claude-haiku-4.5',
  // Strict-privacy tier — uses self-hosted Llama 70B via Modal (different endpoint)
  strict: process.env.LLAMA_ENDPOINT || '',
} as const;
