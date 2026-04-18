/**
 * Long-context dataset for honest compression A/B evaluation.
 *
 * Short prompts (<500 tok) cannot meaningfully benefit from LLM-based
 * compression: the savings potential is bounded by the prompt itself and
 * LLM preambles routinely wipe out any gains. Real compression pays off
 * in *long* contexts:
 *
 *   - RAG: large retrieved blocks with redundancy and filler.
 *   - System prompts: verbose guidelines, examples, boilerplate.
 *   - Chat history: compressible earlier turns while keeping the question.
 *   - Document Q&A: full docs with most content irrelevant to the query.
 *
 * Each entry exposes:
 *   - prompt:       the full input to compress
 *   - category:     rag | system | chat | doc
 *   - expectedAnswerKey: a short phrase the downstream LLM must still
 *                   produce if the compressed prompt kept enough signal
 *                   (used by scripts/quality-judge.mjs)
 *
 * NOTE: this file intentionally ships inline deterministic test text.
 * Content is paraphrased / synthetic so it does not drag external
 * copyrighted sources. Inline filler + repetition is realistic because
 * real RAG traffic contains exactly those artefacts.
 */

const RAG_CORE = `
HTTP rate limiting protects backend services from abusive or runaway clients.
The two canonical algorithms are the token bucket and the sliding window log.
Token bucket keeps a refillable budget per key and is cheap to compute.
Sliding window log is more accurate near the edges of a window boundary.
In practice a Redis-backed sliding window counter is the industry compromise.
Clients that exceed the allowance must receive HTTP 429 with a Retry-After header.
Retry-After can be specified in seconds or as an HTTP-date timestamp.
Rate limit state should be keyed by the most specific identifier available: API key first, then user id, then IP.
Never rate limit internal service-to-service traffic, mark it with a trusted header.
Cache the limit decision for at most one second to avoid hot-key contention.
Emit Prometheus counters for allowed, rejected, and errors separately.
In a multi-region deployment the counters must be regional, not global.
Cross-region aggregation should be delayed by at least five seconds.
`;

const RAG_FILLER = `
Please note that rate limiting is important. Rate limiting is indeed important for production systems. As mentioned before, rate limiting is important.
It is generally accepted that rate limiting should be applied consistently across endpoints. Rate limiting should be applied in production. This is commonly known.
Many teams find that adding rate limiting later is harder than adding it up front. It is often harder later. Adding it up front tends to be easier.
In summary, rate limiting matters for reliability. In conclusion, it matters for reliability and for cost control. To reiterate, this matters.
As a best practice, make sure to enable rate limiting. As a friendly reminder, rate limiting is a best practice. Please remember to enable it.
`;

const RAG_NOISE = `
By the way, the weather has been unpredictable this week.
Also, lunch orders should be submitted by 11 AM.
Remember to mark your calendars for the quarterly all-hands.
Someone left a mug in the kitchen sink again.
Don't forget: donuts in the break room on Friday.
`;

const LEGAL_CORE = `
The service agreement terminates automatically on non-payment beyond 30 days past due.
Either party may terminate for material breach with 15 days written notice.
On termination, the customer must delete all copies of the software within 10 business days.
Fees already paid are non-refundable unless termination is due to vendor material breach.
Confidentiality obligations survive termination for a period of five years.
The governing law is Delaware and disputes go to arbitration in New York.
Liability is capped at the total fees paid during the 12 months preceding the claim.
Indemnification covers third-party IP infringement claims against the software.
Indemnification does not cover misuse, unauthorized modification, or use past termination.
`;

const LEGAL_FILLER = `
Hereby and henceforth, the parties, acknowledging the foregoing, shall be bound.
Notwithstanding anything to the contrary set forth elsewhere in this document, the above remains.
For the avoidance of doubt, nothing herein shall be construed otherwise.
The parties acknowledge and agree that the aforementioned provisions apply mutatis mutandis.
Subject to the terms and conditions herein set forth and nothing further, the parties agree.
Without limitation, the parties further agree that the provisions set out above shall govern.
`.repeat(2);

const MED_CORE = `
Acute myocardial infarction requires immediate reperfusion either by PCI or thrombolysis.
Door-to-balloon time target is under 90 minutes.
Aspirin 325 mg should be given on first medical contact unless contraindicated.
P2Y12 inhibitors are started with the aspirin loading dose.
Anticoagulation with unfractionated heparin or bivalirudin during PCI is standard.
Statins are initiated before discharge regardless of baseline LDL.
Beta blockers within 24 hours if no contraindications like bradycardia or shock.
ACE inhibitors on day one for anterior MI, heart failure, LV dysfunction.
Secondary prevention: dual antiplatelet for 12 months, statin indefinitely.
`;

const MED_FILLER = `
The patient should be informed that these treatments are evidence based.
The treatments listed above are widely accepted in the medical community.
Current guidelines support these interventions. Guidelines are updated periodically.
Please inform the patient about the rationale for each treatment.
`;

const ARCH_CORE = `
The event pipeline ingests webhook events from Stripe, persists them to an append-only ledger in Postgres, and fans them out to downstream consumers through Kafka.
The ledger must be immutable: no UPDATE, no DELETE, enforced by trigger.
Idempotency is achieved via event_id dedup with a partial unique index.
Consumers are at-least-once and must tolerate duplicates with their own dedup keys.
Kafka topics are partitioned by tenant_id to preserve per-tenant ordering.
Consumer lag SLO is under 60 seconds p99. Alert at 30 seconds warning, 60 seconds page.
Schema evolution uses Confluent Schema Registry with backward-compatible rules only.
Breaking changes require a new topic version and dual-write window of 30 days.
Disaster recovery: daily logical backup plus continuous WAL archiving to S3.
Recovery point objective is under 5 minutes. Recovery time objective is under 30 minutes.
All PII fields in events are encrypted at rest using per-tenant KMS keys.
`;

const ARCH_FILLER = `
We want to build something scalable and robust.
We aim to follow industry best practices across the board.
We should focus on maintainability and observability from day one.
Teams should collaborate effectively and document decisions clearly.
Communication across teams is key. Everyone needs to stay aligned.
Let's make sure we have a solid plan before we start. Planning is critical.
`.repeat(3);

function inflate(core, filler, repeatFiller = 2) {
  const blocks = [core.trim()];
  for (let i = 0; i < repeatFiller; i++) blocks.push(filler.trim());
  return blocks.join("\n\n");
}

// ---- RAG category (context + question) ----------------------------------

const RAG_PROMPTS = [
  {
    category: "rag",
    label: "rag-ratelimit-retry-after",
    expectedAnswerKey: "Retry-After",
    prompt: `Use ONLY the reference material below to answer. If the answer is not in the material, reply "insufficient context".\n\n--- REFERENCE START ---\n${inflate(RAG_CORE, RAG_FILLER, 3)}\n\n${RAG_NOISE}\n\n${RAG_FILLER}\n--- REFERENCE END ---\n\nQuestion: What HTTP header must a server include with a 429 response to indicate when the client may retry?`,
  },
  {
    category: "rag",
    label: "rag-ratelimit-key",
    expectedAnswerKey: "API key",
    prompt: `Use ONLY the reference material below to answer. If the answer is not in the material, reply "insufficient context".\n\n--- REFERENCE START ---\n${inflate(RAG_CORE, RAG_FILLER, 3)}\n\n${RAG_NOISE}\n--- REFERENCE END ---\n\nQuestion: According to the material, what identifier should be used first when keying rate-limit state?`,
  },
  {
    category: "rag",
    label: "rag-legal-termination-days",
    expectedAnswerKey: "30 days",
    prompt: `Use ONLY the agreement text below. Cite only facts present in the text.\n\n--- AGREEMENT START ---\n${inflate(LEGAL_CORE, LEGAL_FILLER, 2)}\n--- AGREEMENT END ---\n\nQuestion: After how many days of non-payment does the agreement terminate automatically?`,
  },
  {
    category: "rag",
    label: "rag-legal-liability-cap",
    expectedAnswerKey: "12 months",
    prompt: `Use ONLY the agreement text below. Cite only facts present in the text.\n\n--- AGREEMENT START ---\n${inflate(LEGAL_CORE, LEGAL_FILLER, 3)}\n--- AGREEMENT END ---\n\nQuestion: Liability is capped at the fees paid during which preceding period?`,
  },
  {
    category: "rag",
    label: "rag-med-door-to-balloon",
    expectedAnswerKey: "90 minutes",
    prompt: `You are a clinical assistant. Answer only from the reference below.\n\n--- REFERENCE START ---\n${inflate(MED_CORE, MED_FILLER, 3)}\n\n${inflate(MED_CORE, MED_FILLER, 2)}\n--- REFERENCE END ---\n\nQuestion: What is the target door-to-balloon time for acute MI?`,
  },
  {
    category: "rag",
    label: "rag-med-aspirin-dose",
    expectedAnswerKey: "325 mg",
    prompt: `You are a clinical assistant. Answer only from the reference below.\n\n--- REFERENCE START ---\n${inflate(MED_CORE, MED_FILLER, 4)}\n--- REFERENCE END ---\n\nQuestion: What aspirin dose is given on first medical contact?`,
  },
  {
    category: "rag",
    label: "rag-arch-rpo",
    expectedAnswerKey: "5 minutes",
    prompt: `Use the architecture description below verbatim for facts.\n\n--- ARCHITECTURE START ---\n${inflate(ARCH_CORE, ARCH_FILLER, 3)}\n--- ARCHITECTURE END ---\n\nQuestion: What is the Recovery Point Objective (RPO)?`,
  },
  {
    category: "rag",
    label: "rag-arch-partition-key",
    expectedAnswerKey: "tenant_id",
    prompt: `Use the architecture description below verbatim for facts.\n\n--- ARCHITECTURE START ---\n${inflate(ARCH_CORE, ARCH_FILLER, 3)}\n--- ARCHITECTURE END ---\n\nQuestion: Which field is used as the Kafka partition key?`,
  },
];

// ---- System prompt category (long operator/agent prompts) ---------------

const SYSTEM_BASE = `You are a senior backend engineering assistant operating inside an IDE.
Your persona is precise, terse, and strictly professional.
You have access to the following tools: shell, file_read, file_write, grep, web_search.
Always prefer file_read over shell cat. Always prefer grep over shell grep.
Never run destructive shell commands such as rm -rf, DROP TABLE, or force-push.
When uncertain, ask for clarification in a single short sentence.
When confident, act immediately and narrate briefly what you are doing.
Do not introduce new dependencies without explicit user approval.
Do not commit changes unless the user explicitly requests a commit.
Never edit .env files, credential files, or secrets.
Preserve the project's existing code style, indentation, and import order.
When writing code, include only the minimum comments needed to explain intent.
Never output explanatory preambles like "Sure" or "Here is the compressed prompt".
Always return plain text or the requested code; never wrap everything in markdown fences.
Responses must fit on the user's screen unless the user explicitly asks for a long response.
If a tool returns an error, surface the error verbatim before attempting a fix.
Respect rate limits: if a network tool fails repeatedly, stop and report.
Operate with least privilege: do not read files outside the workspace without permission.
Always double-check that paths exist before editing.
`;

const SYSTEM_GUIDELINES = `
Code quality guidelines you must follow:
- Functions should do one thing. Prefer early returns over nested conditionals.
- Names should be descriptive; avoid single-letter variables except for loop counters.
- Avoid magic numbers; promote them to named constants.
- Error paths must never be silently swallowed; at minimum log and rethrow.
- For network calls, set explicit timeouts and a maximum retry count.
- For database writes, prefer transactions for multi-row changes.
- For reads, prefer prepared statements to concatenated SQL to avoid injection.
- For any external input, validate shape before using it.
- For any user-facing error, never leak stack traces or internal identifiers.
- For any logging, never log secrets, passwords, tokens, or full PII.
- Use structured logging with a correlation id field on every entry.
- Feature flags should default to off for safety.
- Every long-running task must expose a healthcheck.
- Every background worker must handle graceful shutdown on SIGTERM.
- Every new endpoint must include basic metrics: count, latency, error count.
- Tests must cover happy path, one error path, and one boundary condition.
- Do not use skip or only tags when committing tests.
- Snapshot tests are only acceptable for stable serialized output, not dynamic data.
- Prefer integration tests over mock-heavy unit tests when the integration is realistic.
- Public API changes require a migration note.
`;

const SYSTEM_REPETITION = `
Remember: never log secrets. Remember: never log secrets.
Remember: never commit without explicit user permission. Remember: never commit without explicit user permission.
Be terse. Be terse. Be precise. Be precise.
Do not invent files. Do not invent APIs. Do not invent library behavior.
Always verify before asserting. Always verify before asserting.
`.repeat(4);

const SYSTEM_PROMPTS = [
  {
    category: "system",
    label: "system-backend-agent",
    expectedAnswerKey: "ready",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: Reply with just the single word ready to confirm you understood the guidelines.`,
  },
  {
    category: "system",
    label: "system-review-checklist",
    expectedAnswerKey: "timeout",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: From the guidelines, name one requirement for network calls.`,
  },
  {
    category: "system",
    label: "system-logging-rule",
    expectedAnswerKey: "secrets",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: From the guidelines, what must never appear in logs?`,
  },
  {
    category: "system",
    label: "system-sigterm-behavior",
    expectedAnswerKey: "graceful shutdown",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: From the guidelines, how must workers behave on SIGTERM?`,
  },
  {
    category: "system",
    label: "system-feature-flag-default",
    expectedAnswerKey: "off",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: From the guidelines, what is the safe default for feature flags?`,
  },
  {
    category: "system",
    label: "system-commit-policy",
    expectedAnswerKey: "explicit",
    prompt: `${SYSTEM_BASE}\n${SYSTEM_GUIDELINES}\n${SYSTEM_REPETITION}\n\nUser task: From the guidelines, when is committing allowed?`,
  },
];

// ---- Chat history category (long prior dialogue + current question) -----

function chatHistory(turns) {
  return turns
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
}

const GENERIC_CHAT = [
  { role: "user", content: "Hi, I want help with my Node.js service." },
  { role: "assistant", content: "Sure, what is the service doing and what's the issue?" },
  { role: "user", content: "It processes Stripe webhook events and writes to Postgres." },
  { role: "assistant", content: "Got it. Are you seeing performance, correctness, or reliability problems?" },
  { role: "user", content: "Reliability, mostly. Sometimes we double-process an event." },
  { role: "assistant", content: "Double processing usually means the idempotency key is missing or not unique." },
  { role: "user", content: "We use the Stripe event id as the idempotency key." },
  { role: "assistant", content: "And do you have a unique index on that column in the database?" },
  { role: "user", content: "We have an index but it's not unique." },
  { role: "assistant", content: "That is the root cause. Make the index unique on event_id." },
  { role: "user", content: "But we have legacy duplicates in the table already." },
  { role: "assistant", content: "Deduplicate first with a migration that keeps the earliest row per event_id, then add the unique constraint." },
  { role: "user", content: "Ok, makes sense. What about retries from Stripe?" },
  { role: "assistant", content: "Stripe retries are safe once you have the unique constraint: the second insert fails and you can safely no-op." },
  { role: "user", content: "We also log the full event body. Is that ok?" },
  { role: "assistant", content: "Only if you redact PII fields before logging. Otherwise you accumulate regulated data in your log store." },
  { role: "user", content: "What fields are considered PII here?" },
  { role: "assistant", content: "Cardholder name, email, phone, billing address, and the last four of the card at minimum." },
];

const CHAT_PROMPTS = [
  {
    category: "chat",
    label: "chat-idempotency-key",
    expectedAnswerKey: "event_id",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, what field should the unique index be on?`,
  },
  {
    category: "chat",
    label: "chat-pii-fields",
    expectedAnswerKey: "cardholder",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, name one of the PII fields I should redact.`,
  },
  {
    category: "chat",
    label: "chat-retry-behavior",
    expectedAnswerKey: "unique",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, why are Stripe retries safe once I fix the index?`,
  },
  {
    category: "chat",
    label: "chat-migration-order",
    expectedAnswerKey: "deduplicate",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, what is the first migration step?`,
  },
  {
    category: "chat",
    label: "chat-root-cause",
    expectedAnswerKey: "unique",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, what was the actual root cause of double processing?`,
  },
  {
    category: "chat",
    label: "chat-log-policy",
    expectedAnswerKey: "redact",
    prompt: `Conversation so far:\n${chatHistory(GENERIC_CHAT)}\n\nUSER: In ONE short sentence, what must I do before logging the event body?`,
  },
];

// ---- Document Q&A category (README / docs style inputs) -----------------

const FAKE_README = `
# ExampleLib

ExampleLib is a tiny utility for stream-safe JSON parsing in Node.js.

## Installation

Install from npm:

\`\`\`
npm install examplelib
\`\`\`

## Motivation

JSON.parse loads the entire string in memory. ExampleLib parses incrementally.
This is useful for large payloads, log ingestion, and memory-constrained environments.

## Usage

\`\`\`js
import { createParser } from "examplelib";
const parser = createParser();
parser.on("value", (v) => console.log(v));
parser.write(chunk1);
parser.write(chunk2);
parser.end();
\`\`\`

## Configuration

The parser accepts an options object:

- \`maxDepth\` — default 64. Reject documents nested deeper than this.
- \`maxStringLength\` — default 1048576 (1 MiB). Reject strings longer than this.
- \`allowComments\` — default false. Allow // and /* */ comments.
- \`allowTrailingCommas\` — default false.
- \`bigintStrategy\` — "number" | "string" | "bigint". Default "number".

## Error handling

Parse errors emit an \`error\` event. The parser does not throw.
Every error includes the byte offset and a human-readable reason.
Once an error is emitted the parser is no longer usable.

## Performance

In benchmarks on large JSON Lines files, ExampleLib sustains around 180 MB/s on a single core.
Memory usage stays flat regardless of document size.
No temporary allocations occur per value in the fast path.

## Security

ExampleLib is safe against stack overflow on deeply nested inputs thanks to maxDepth.
It is safe against memory exhaustion on giant strings thanks to maxStringLength.
It does not evaluate any input, so prototype pollution is not possible.

## License

MIT.

## FAQ

**Does it support streaming arrays?** Yes, emit one value per element.
**Does it support async iterators?** Yes, via \`parser.asyncIterator()\`.
**Does it support JSON5?** Only with \`allowComments\` and \`allowTrailingCommas\` set to true.
**Is it faster than JSON.parse on small inputs?** No. Use JSON.parse for small inputs.
**Can I reuse a parser after an error?** No, create a new instance.
`;

const DOC_PROMPTS = [
  {
    category: "doc",
    label: "doc-max-depth-default",
    expectedAnswerKey: "64",
    prompt: `You are a documentation assistant. Use ONLY the README below.\n\n${FAKE_README}\n\n${FAKE_README}\n\nQuestion: What is the default value of maxDepth?`,
  },
  {
    category: "doc",
    label: "doc-benchmarks-throughput",
    expectedAnswerKey: "180",
    prompt: `You are a documentation assistant. Use ONLY the README below.\n\n${FAKE_README}\n\n${FAKE_README}\n\nQuestion: What throughput does ExampleLib sustain on a single core?`,
  },
  {
    category: "doc",
    label: "doc-after-error",
    expectedAnswerKey: "new instance",
    prompt: `You are a documentation assistant. Use ONLY the README below.\n\n${FAKE_README}\n\n${FAKE_README}\n\nQuestion: After an error, can the parser be reused?`,
  },
  {
    category: "doc",
    label: "doc-license",
    expectedAnswerKey: "MIT",
    prompt: `You are a documentation assistant. Use ONLY the README below.\n\n${FAKE_README}\n\n${FAKE_README}\n\nQuestion: What license does the library use?`,
  },
  {
    category: "doc",
    label: "doc-json5",
    expectedAnswerKey: "allowComments",
    prompt: `You are a documentation assistant. Use ONLY the README below.\n\n${FAKE_README}\n\n${FAKE_README}\n\nQuestion: Which two options must be set to true to support JSON5?`,
  },
];

export const LONG_CONTEXT_PROMPTS = [
  ...RAG_PROMPTS,
  ...SYSTEM_PROMPTS,
  ...CHAT_PROMPTS,
  ...DOC_PROMPTS,
];
