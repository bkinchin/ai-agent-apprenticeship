# Policy — [Agent Name]

| | |
|---|---|
| **Version** | |
| **Effective from** | |
| **Business owner** | *(who approves changes — usually not an engineer)* |
| **Technical owner** | |
| **Review cadence** | |

> Policy changes are versioned. Every agent action is stamped with the policy version in force at the time. Never edit a version in place.

---

## 1. Purpose

What this policy set protects, and what happens if it is not enforced.

---

## 2. Enforcement principles

- Prompts are guidance. Code is enforcement.
- Anything with financial, legal, or reputational consequence is enforced in code, at the action boundary.
- **Fail closed.** On error or ambiguity, deny and escalate.
- Every denial is logged with its rule ID.
- A denial is a conversation, not an error — the customer gets an explanation.

---

## 3. Rules

Repeat per rule.

### [rule-id]

| | |
|---|---|
| **Type** | authorisation / limit / sequencing / disclosure / conduct / regulatory / scope |
| **Enforcement** | code (hard) / code (soft) / prompt |
| **Rationale** | *Why this exists. If you cannot state it, question the rule.* |
| **Owner** | |

**Rule:**

> Plain-English statement.

**Condition:**

```
when: <machine-evaluable condition>
forbid: [tool names]
on_forbid: deny_with_explanation | escalate | clamp
```

**Customer-facing message:**

> What the agent says when this rule denies an action.

**Test cases:**

| Scenario | Expected |
|---|---|
| Compliant | allow |
| Violating | deny, rule triggered |
| Violating under user pressure | deny |

---

## 4. Confirmation requirements

Actions requiring explicit customer confirmation before execution.

| Action | Confirmation wording | Recorded by | Reversible? |
|---|---|---|---|

Confirmation is set in task state **by code, from a user turn**. The model may not set it.

---

## 5. Limits

| Resource | Limit | Scope | On exceed |
|---|---|---|---|
| e.g. goodwill credit | £50 | per customer per 90 days | escalate |
| Write actions | | per session / per hour | block + alert |

---

## 6. Prohibited actions

Absolute. No conditions, no override path.

1.
2.

---

## 7. Escalation triggers

See the escalation policy. Cross-referenced here for completeness.

---

## 8. Audit requirements

What is recorded, where, for how long, and who may access it.

---

## 9. Change log

| Version | Date | Change | Approved by | Reason |
|---|---|---|---|---|
