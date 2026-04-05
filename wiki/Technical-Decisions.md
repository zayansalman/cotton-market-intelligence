# Technical Decisions

Every significant engineering trade-off in Cotton Market Intelligence, with rationale.

---

## 1. Next.js 16 App Router

**Decision**: Ship frontend, API, and ML inference as a single Next.js application.

**Why**: Server components and API route handlers coexist in one codebase. A single `vercel deploy` publishes everything -- no CORS configuration, no separate backend service, no infrastructure to manage. TypeScript types are shared between API routes and client components, so a schema change in `/api/strategy` immediately type-checks against `useStrategy.ts`.

**Alternatives considered**: Express + React SPA (two deploys, CORS, separate CI), FastAPI + React (Python/TypeScript boundary, serialization overhead, two CI pipelines), Remix (less mature API route patterns for ML workloads).

**Trade-offs**: Locked into Vercel's serverless model. Cold starts affect first-request latency on the prediction pipeline. API routes share the same domain, which simplifies security but means a misbehaving route can affect the frontend build. Acceptable for a single-product application at this scale.

---

## 2. No Database (Stateless Server)

**Decision**: Zero server-side persistence. All market data comes from external APIs at request time. User state lives in localStorage.

**Why**: Cotton prices, macro indicators, and news headlines are inherently real-time data. There is nothing to cache in a database that would not be stale within hours. Vercel's hobby tier has no persistent storage, and adding a database (Supabase, PlanetScale, Neon) introduces migration risk, connection pooling concerns, and operational overhead for a tool that does not need it.

**Alternatives considered**: PostgreSQL for historical price caching (rejected: Yahoo Finance serves 5 years of history in <1s), Redis for session state (rejected: no user accounts to track), SQLite via Turso (rejected: adds a dependency for marginal benefit).

**Trade-offs**: No user accounts, no server-side session persistence, no audit trail. Rate limiting resets on cold start because counters are in-memory. Every prediction request re-fetches market data from Yahoo Finance. These are acceptable: the target user base is small (iFarmer procurement team), data freshness is a feature not a bug, and approximate rate limiting is sufficient.

---

## 3. TypeScript ML Models

**Decision**: Ridge regression and gradient boosted decision stumps implemented in pure TypeScript with no external dependencies.

**Why**: The entire application is one language. Models deploy as part of the same Vercel serverless function -- no Python microservice, no Docker container, no model serialization format, no gRPC boundary. Training runs in <500ms on the feature matrix (approximately 1200 rows, 30 features, 6 models). The normal equations for ridge regression are analytically solvable for small feature sets.

**Alternatives considered**: Python scikit-learn behind a FastAPI endpoint (rejected: adds a second language, a second deploy, network latency on every prediction), ONNX Runtime in Node.js (rejected: dependency weight, limited TypeScript types), TensorFlow.js (rejected: overkill for linear models and shallow trees).

**Trade-offs**: No access to the scikit-learn/PyTorch ecosystem. Models are deliberately simple -- ridge regression and single-split boosted stumps. No XGBoost, no neural networks, no hyperparameter search. Counter-argument: for this use case (daily commodity price direction with 30 engineered features), simple models with proper walk-forward validation outperform complex models that overfit. The bottleneck is feature quality and data volume, not model complexity.

---

## 4. Zod for Validation

**Decision**: Use Zod as the single source of truth for both runtime validation and TypeScript types at every API boundary.

**Why**: One schema definition generates runtime parsing (with detailed error messages) and compile-time types. The `.strict()` modifier rejects unknown fields, which is a security measure -- unexpected keys in a POST body are rejected before reaching business logic. The `.describe()` method allows schemas to self-document. Zod 4 has the best developer experience of any TypeScript validation library.

**Alternatives considered**: io-ts (functional style, steeper learning curve, less adoption), Yup (weaker TypeScript inference, no `.strict()` equivalent), Ajv with JSON Schema (two representations -- schema + TypeScript type -- that can drift), manual validation (error-prone, no type narrowing).

**Trade-offs**: Runtime overhead of schema parsing on every request. Negligible in practice -- Zod parses a strategy request payload in <1ms. The library adds approximately 50 KB to the server bundle.

---

## 5. In-Memory Rate Limiting

**Decision**: Rate limiting uses in-memory Maps (per-IP sliding window + burst detection), not Redis or a database.

**Why**: Vercel serverless functions are ephemeral. A Redis instance (Upstash, for example) adds latency to every request for a guarantee that rate limiting is already approximate by nature. In-memory buckets are fast (Map lookup), require zero infrastructure, and provide good-enough protection against abuse. The rate limiter supports per-endpoint configuration, burst detection within 10-second micro-windows, and cooldown periods -- all without external dependencies.

**Alternatives considered**: Upstash Redis (rejected: adds 10-20ms latency per check, costs money, over-engineered for this scale), Vercel KV (rejected: same latency concern), Cloudflare rate limiting (rejected: not using Cloudflare).

**Trade-offs**: Limits reset on cold start. In a multi-instance serverless environment, each instance has its own counters, so an attacker could theoretically hit different instances. Acceptable for the current user base. If the application scales to public use, Upstash Redis is a straightforward migration -- the `evaluateRequestRateLimit` interface is designed to be backend-agnostic.

---

## 6. HF-First AI Routing

**Decision**: Hugging Face Inference API is the primary AI provider. OpenAI is an explicit opt-in fallback. Heuristic is always available.

**Why**: Hugging Face offers free inference for open models. Qwen 2.5 7B Instruct is competitive with GPT-4o-mini for structured JSON output tasks like strategy generation. Using open models avoids vendor lock-in and keeps costs at zero for the default configuration. OpenAI requires `ALLOW_OPENAI_FALLBACK=1` as an explicit environment variable -- it is never called unless the operator deliberately enables it.

**Alternatives considered**: OpenAI-first (rejected: cost scales with usage, vendor lock-in), Anthropic Claude (rejected: higher cost per token for structured output), local model inference via llama.cpp (rejected: Vercel serverless has no GPU, cold start would be seconds).

**Trade-offs**: Hugging Face Inference API has variable latency (cold model loading can take 20-30 seconds on first call). The 30-second timeout handles this. Model quality depends on what is available on the free tier. If HF is down, the system falls through to OpenAI (if configured) or heuristic. The heuristic is always available and provides a statistically sound baseline.

---

## 7. Graceful Degradation Everywhere

**Decision**: Every external dependency can fail, and the application continues to function.

**Why**: A cotton spinning mill running procurement during a buying window cannot afford "Service Unavailable." The system is designed so that at every level, failure of an upstream component degrades quality but never blocks the user. If Yahoo Finance is down, the API returns a 502 but the UI still renders. If HF and OpenAI both fail, the heuristic strategy works with local statistical analysis. If FRED is unreachable, the prediction pipeline runs with fewer factors. If all RSS feeds timeout, the strategy generates without news context.

**Alternatives considered**: Fail-fast with clear error messages (rejected: unhelpful when the user needs to make a procurement decision now), retry with exponential backoff (rejected: adds latency, serverless functions have execution time limits).

**Trade-offs**: The user may not always realize they are getting degraded output. The system mitigates this by including the `source` and `provider` fields in strategy responses, adding risk factors when AI is unavailable, and showing the data freshness timestamp in the UI.

---

## 8. Feature Branch Previews Disabled

**Decision**: `vercel.json` explicitly disables Vercel Git Integration for `feature/*`, `fix/*`, and `hotfix/*` branches.

**Why**: Vercel's default behavior creates a preview deployment for every branch push. With active development across multiple feature branches, this consumes deployment minutes and creates stale preview URLs that nobody visits. The `develop` branch auto-deploys to `cmi-notebooks-dev.vercel.app`, which serves as the single staging environment.

**Alternatives considered**: Allow all previews (rejected: quota waste), use Vercel's ignored build step (rejected: more complex, same outcome), separate CI with manual deploy triggers (rejected: over-engineering).

**Trade-offs**: No per-PR preview URLs for reviewers. Reviewers must either check out the branch locally or wait for the PR to merge into `develop` to see it on the dev deployment. Acceptable given the small team size.

---

## 9. Recharts Over D3

**Decision**: Use Recharts (declarative React charting) instead of D3 (imperative DOM manipulation).

**Why**: CMI needs area charts, bar charts, and composed overlays (price + MA + forecast bands). Recharts provides all of these as React components with props-driven data flow, consistent with how the rest of the application manages state. Building equivalent charts in D3 would require manual DOM management, ref-based rendering, and resize handling -- all solved problems in Recharts.

**Alternatives considered**: D3 (rejected: imperative style conflicts with React, slower to build for standard chart types), Victory (rejected: less active maintenance), Nivo (rejected: heavier bundle, less customizable for financial overlays), Tremor (rejected: opinionated styling that conflicts with the dark theme).

**Trade-offs**: Less customization than D3 for exotic visualizations. Recharts does not support candlestick charts natively, so if the application ever needs OHLC charting, D3 or a specialized library would be needed. For the current chart types (area, bar, composed with reference lines), Recharts is sufficient.

---

## 10. localStorage Over IndexedDB

**Decision**: Scenarios, alerts, and portfolio data stored in `localStorage` as serialized JSON.

**Why**: The data model is simple -- arrays of JSON objects, each under 100 KB. localStorage provides a synchronous, key-value API that maps directly to `JSON.parse`/`JSON.stringify`. No schema migrations, no async handling, no cursor-based iteration. The stores wrap localStorage with typed getters and setters, handling corrupt data gracefully (parse failure resets to defaults).

**Alternatives considered**: IndexedDB (rejected: async API, transaction overhead, cursor-based queries -- all unnecessary for flat JSON blobs), cookies (rejected: size limits, sent with every request), Zustand with persist middleware (rejected: adds a state management library for simple key-value storage).

**Trade-offs**: 5 MB storage limit per origin. Synchronous reads block the main thread. Data is not shared across browsers or devices. All acceptable: total data is typically under 100 KB, reads complete in <1ms, and the application is used on a single workstation.

---

## 11. Vitest Over Jest

**Decision**: Use Vitest as the test runner for unit and integration tests.

**Why**: Vitest has native ESM support, which Next.js 16 and the TypeScript codebase require. Jest needs transform configuration (babel-jest or ts-jest) to handle ESM imports and TypeScript, and the configuration is fragile across Node.js versions. Vitest works out of the box with the existing `tsconfig.json` and runs tests faster due to its use of Vite's transform pipeline.

**Alternatives considered**: Jest with ts-jest (rejected: ESM transform configuration is brittle, slower execution), Jest with SWC transform (rejected: still requires explicit configuration for path aliases), Node.js native test runner (rejected: immature assertion library, no watch mode).

**Trade-offs**: Smaller ecosystem of plugins compared to Jest. Some testing patterns (like manual mocks in `__mocks__` directories) work differently. Neither has been a practical issue for this codebase.

---

## 12. No Authentication

**Decision**: All API endpoints are public. No user accounts, no sessions, no JWT tokens.

**Why**: CMI is an internal tool for the iFarmer procurement team. Adding authentication increases complexity (login flow, token refresh, session management, password reset) for a user base that currently fits in one room. Security is instead provided by the defense-in-depth stack: abuse protection blocks bot traffic, rate limiting caps request volume, payload guards reject malformed input, Zod schemas reject unexpected fields, and usage quotas prevent AI cost overruns.

**Alternatives considered**: NextAuth.js with Google OAuth (rejected: adds a database requirement for sessions, GDPR implications), API key in headers (rejected: key management overhead, no benefit over rate limiting for internal use), Vercel password protection (rejected: applies to the entire domain, not just API routes).

**Trade-offs**: Anyone who discovers the URL can use the tool. The rate limiting and quota system ensures this cannot cause meaningful cost. If the tool is ever exposed to external users (e.g., iFarmer's mill clients), authentication should be the first addition. The API security layer is designed so that adding an auth check is a single middleware addition at the top of the security pipeline.
