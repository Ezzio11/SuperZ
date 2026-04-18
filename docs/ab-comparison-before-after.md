# SuperZ Roadmap Comparison (Before vs After)

## Scope
- **Before roadmap changes**: `reports/ab-2026-04-18T14-40-03-973Z.json`
- **After roadmap implementation**: `reports/ab-2026-04-18T15-06-09-604Z.json`
- Dataset: 50 prompts (`small=15`, `medium=20`, `large=15`)
- Target model: `llama-3.1-8b-instant` via Groq
- Compressor: `OpenRouter-Free`

## Key Metrics

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Input tokens saved (total) | 153 | 84 | -69 |
| Mean reduction ratio | 1.84% | 0.99% | -0.85 pp |
| Compression win rate | 16.00% | 14.00% | -2.00 pp |
| No-regression rate | 100.00% | 100.00% | 0.00 pp |
| P-value (paired) | 0.0111 | 0.0381 | weaker significance |
| Constraint survival (neg/num/schema) | 100/100/100 | 100/100/100 | unchanged |

## Size-Bucket View

| Bucket | Before saved total | After saved total | Delta |
| --- | ---: | ---: | ---: |
| small | 0 | 0 | 0 |
| medium | 0 | 0 | 0 |
| large | 153 | 84 | -69 |

## Caching Observability Status
- Added cache telemetry fields and report metrics:
  - `compression_cache_hit_ratio`
  - `compression_cache_input_cost_saved_estimate`
- Current run shows:
  - `compression_cache_hit_ratio = 0.00% (0/0)`
  - no provider-reported cached prompt token counts in this path.

## Interpretation
- Safety gates remained strong (`no_regression=100%`, constraints preserved).
- Token savings are still concentrated in **large** prompts.
- The new dynamic tiering is conservative for medium prompts (intentionally safety-first).
- Caching instrumentation is in place, but this provider path did not emit cache usage counters.

## Follow-up
1. Run same 50-prompt benchmark on a cache-reporting provider/model combination (OpenAI/Anthropic where available).
2. Tune medium-tier policy to improve savings without reducing constraint survival.
3. Keep large-tier extractive path as primary source of stable gains.

