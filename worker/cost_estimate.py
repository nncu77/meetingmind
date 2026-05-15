"""LLM cost adder — mirrors lib/cost/estimate.ts PRICES.sonnet_45_*."""
import math

SONNET_45_INPUT_PER_MTOK = 3.0
SONNET_45_OUTPUT_PER_MTOK = 15.0


def add_llm_cost_cents(input_tokens: int, output_tokens: int) -> int:
    usd = (input_tokens / 1_000_000) * SONNET_45_INPUT_PER_MTOK
    usd += (output_tokens / 1_000_000) * SONNET_45_OUTPUT_PER_MTOK
    return math.ceil(usd * 100)
