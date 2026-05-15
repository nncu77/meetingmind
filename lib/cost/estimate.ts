/**
 * Cost estimator. Prices are a 2026-05 snapshot — keep this file as the
 * single source of truth and update PRICES when vendors change.
 *
 * Why bother? Portfolio projects die when one runaway audio job racks up
 * $50 on Modal. Storing cost_estimate_cents per meeting lets us:
 *   1) cap monthly burn per org
 *   2) show "this month so far: $X.XX" in the admin UI
 *   3) flag outlier meetings (e.g., cold-start spike) in /eval
 */

export const PRICES = {
  modal_a10g_per_sec: 0.000306,    // $1.10/hr
  modal_l4_per_sec: 0.000222,      // $0.80/hr
  modal_cpu_per_sec: 0.0000375,    // $0.135/hr

  // Groq Whisper free tier (whisper-large-v3 — 7,200 audio sec/day free)
  // After free tier: $0.111/hour-of-audio ≈ $0.0000308/sec
  groq_paid_per_audio_sec: 0.0000308,

  // OpenRouter Anthropic pass-through pricing
  sonnet_45_input_per_mtok: 3.0,
  sonnet_45_output_per_mtok: 15.0,
  haiku_45_input_per_mtok: 0.80,
  haiku_45_output_per_mtok: 4.0,
} as const;

export type SttBackend = 'groq' | 'local';
export type GpuTier = 'a10g' | 'l4' | 'cpu';
export type LlmModel = 'sonnet' | 'haiku';

export interface CostInputs {
  audioDurationSec: number;
  sttBackend: SttBackend;
  gpu: GpuTier;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmModel: LlmModel;
  /** Cold start overhead is paid once per warm-container generation. */
  isColdStart?: boolean;
  /** Groq free-tier remaining seconds (for the day). If audio fits, STT cost = 0. */
  groqFreeBudgetRemainingSec?: number;
}

/**
 * Estimate the marginal cost in USD cents for processing one meeting.
 * Returns an integer (cents). Rounded up to avoid under-counting.
 */
export function estimateMeetingCostCents(i: CostInputs): number {
  let usd = 0;

  // ---- STT --------------------------------------------------------------
  if (i.sttBackend === 'groq') {
    const budget = i.groqFreeBudgetRemainingSec ?? Infinity;
    const billableSec = Math.max(0, i.audioDurationSec - budget);
    usd += billableSec * PRICES.groq_paid_per_audio_sec;
  } else {
    // faster-whisper Large v3 ~ 10x realtime on A10G, ~7x on L4, ~0.4x on CPU
    const factor = i.gpu === 'a10g' ? 10 : i.gpu === 'l4' ? 7 : 0.4;
    const whisperSec = i.audioDurationSec / factor;
    usd += whisperSec * gpuRate(i.gpu);
  }

  // ---- Diarization (pyannote) ------------------------------------------
  // ~5x realtime on CPU, ~25x on GPU
  const diarFactor = i.gpu === 'cpu' ? 5 : 25;
  const diarSec = i.audioDurationSec / diarFactor;
  usd += diarSec * gpuRate(i.gpu);

  // ---- LLM extraction --------------------------------------------------
  const rates =
    i.llmModel === 'sonnet'
      ? { in: PRICES.sonnet_45_input_per_mtok, out: PRICES.sonnet_45_output_per_mtok }
      : { in: PRICES.haiku_45_input_per_mtok, out: PRICES.haiku_45_output_per_mtok };
  usd += (i.llmInputTokens / 1_000_000) * rates.in;
  usd += (i.llmOutputTokens / 1_000_000) * rates.out;

  // ---- Cold start ------------------------------------------------------
  // Loading Whisper Large v3 = ~70s, pyannote only = ~10s
  if (i.isColdStart) {
    const coldSec = i.sttBackend === 'local' ? 70 : 10;
    usd += coldSec * gpuRate(i.gpu);
  }

  return Math.ceil(usd * 100);
}

function gpuRate(tier: GpuTier): number {
  return tier === 'a10g'
    ? PRICES.modal_a10g_per_sec
    : tier === 'l4'
    ? PRICES.modal_l4_per_sec
    : PRICES.modal_cpu_per_sec;
}

// ---------------------------------------------------------------------------
// Plan limits — used by the upload route + UI to cap usage.
// Tuning rationale:
//   free: portfolio demo — keep monthly burn under $5 even if abused
//   team: real SMB users — covers 95% of meeting lengths
//   business: enterprise — large meetings, large daily volume
// ---------------------------------------------------------------------------

export const PLAN_LIMITS = {
  free: {
    maxAudioSec: 5 * 60,
    dailyMeetings: 3,
    maxMonthlyCostCents: 500,    // $5
  },
  team: {
    maxAudioSec: 60 * 60,
    dailyMeetings: 50,
    maxMonthlyCostCents: 5000,   // $50
  },
  business: {
    maxAudioSec: 180 * 60,
    dailyMeetings: 500,
    maxMonthlyCostCents: 50000,  // $500
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
