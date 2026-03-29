# Bangladesh spinning sector — product fit

Bangladesh is one of the world’s largest **yarn and textile** producers; mills import **bulk cotton** (often USD-priced, letter-of-credit terms) and care about **ICE / USDA / weather / freight** narratives as much as local headlines.

## How this stack maps

| Need | Feature |
|------|---------|
| **Price vs history** | Value percentile rank, vol-adjusted signals |
| **When to lift cover** | Multi-month roadmap (tonnes by month) |
| **Global news** | RSS + **FinBERT** (English financial tone) |
| **Local / Bengali press** | Set `CMI_HF_SENTIMENT_MODEL=nlptown/bert-base-multilingual-uncased-sentiment` and add Bengali RSS in `config/news_feeds.yml` |
| **Execution** | Near-term suggested tonnes from mill profile (spindles, inventory days) |

## Deployment notes (production)

- **Hardware**: CPU inference is enough for daily batch runs; use **GPU** (`CMI_HF_DEVICE=cuda`) if you batch many mills on one server.
- **Caching**: Point `HF_HOME` (and `TRANSFORMERS_CACHE`) to a persistent volume so models are not re-downloaded.
- **Data**: Add **licensed** news APIs or exchange feeds alongside RSS for coverage; keep HF as a **layer**, not the only input.
- **Governance**: Bank-style mills will want **audit logs** (`plan_to_dict` JSON), fixed configs, and optional sign-off on tranche changes.

## Commercial wedge

Sell **decision support + audit trail**: deterministic rules + transparent NLP blend + optional OpenAI narrative — not a black-box “AI trader.”
