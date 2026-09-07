// What the agent depended on, as facts rather than declarations.
//
// A VERSION YOU TYPE IS A VERSION THAT DRIFTS. Every YAML in this
// project carries a hand-maintained `last_updated`, and every one of
// them is a claim somebody has to remember to update. A content hash is
// not a claim.
//
// This matters more for agents than for services, because "nothing was
// deployed" is almost never true: the model changes underneath you, the
// corpus changes, the supplier changes, and none of that touches the
// repository. When quality drops on a Tuesday, the only way to answer
// "what changed on Monday" is to have stamped every span with what it
// depended on.

import { createHash } from "node:crypto";

export interface Versions {
  model: string;
  /** The system prompt TEMPLATE, not the rendered one — that varies per member. */
  prompt: string;
  /** Rules and escalation policy: what the agent is allowed to do. */
  policy: string;
  /** Documents and structured data: what the agent knows. */
  corpus: string;
}

/** Short, because these appear on every span and are read by humans. */
const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 8);

export function computeVersions(args: {
  model: string;
  promptTemplate: string;
  docs: { id: string; body: string }[];
  structured: Record<string, unknown>;
}): Versions {
  // POLICY AND CORPUS ARE SEPARATE HASHES.
  //
  // They fail differently and they are changed by different people. A
  // corpus edit that breaks an answer and a policy edit that breaks a
  // booking need to be distinguishable at a glance, and one combined
  // hash would only tell you that "something in the data moved".
  const policyFiles = ["escalation.yaml", "booking-rules.yaml", "fees.yaml"];
  const policy = policyFiles
    .map((f) => `${f}:${JSON.stringify(args.structured[f] ?? null)}`)
    .join("\n");

  const corpus = [
    ...args.docs.map((d) => `${d.id}:${d.body}`),
    ...Object.entries(args.structured)
      .filter(([f]) => !policyFiles.includes(f))
      .map(([f, v]) => `${f}:${JSON.stringify(v)}`),
  ].join("\n");

  return {
    model: args.model,
    prompt: hash(args.promptTemplate),
    policy: hash(policy),
    corpus: hash(corpus),
  };
}
