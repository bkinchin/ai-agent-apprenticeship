# shared/tools

The tool abstraction: type, registry, executor, and reusable patterns.

## The contract

```ts
interface Tool<A> {
  name: string;
  description: string;          // the highest-leverage text in your system
  parameters: z.ZodType<A>;
  kind: "read" | "write";
  idempotent?: boolean;         // required to be true for write tools
  timeoutMs?: number;
  execute: (args: A, ctx: ToolContext) => Promise<ToolResult>;
}
```

## Executor responsibilities

Every tool call passes through, in order:

1. Tool exists
2. Arguments validate (Zod) — failure returns a helpful message, does not throw
3. **Policy engine decision** (day 6) — mandatory, structurally unskippable
4. Confirmation requirement satisfied
5. Idempotency check — return the original result if already executed
6. Execute with timeout
7. Retry per the failure-type policy (day 10) — never retry a 4xx
8. Map errors into text written *for the model*
9. Trace and audit

## Reusable patterns

| Pattern | Day | Use |
|---|---|---|
| Read/write tagging | 3 | Different rules for tools that change the world |
| Idempotency keys | 10 | Derived from intent, not time |
| Hold / confirm | 10 | Contended resources |
| Orchestrated + compensation | 10 | Multi-step ops exposed as one tool |
| Circuit breaker | 10 | Failing dependencies |
| Rate limits | 14 | Every write tool, without exception |

## Design rules

- Narrow tools beat flexible ones. Enums beat free text.
- Error messages are prompts. Write them so the model can recover.
- Return what the model needs to decide, not your database schema.
- Fewer than ~20 tools per agent; beyond that, route or split.
- Multi-step operations are **one tool** to the model. Orchestration is your problem, not its.

> **Populated from:** days 3, 10
