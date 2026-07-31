import type Anthropic from "@anthropic-ai/sdk";

export interface AssembleInput {
  systemPrompt: string;
  taskState: Record<string, string>;
  history: Anthropic.MessageParam[];
  window: number;
}

export interface AssembledContext {
  system: string;
  messages: Anthropic.MessageParam[];
}

export function assemble(input: AssembleInput): AssembledContext {
  const { systemPrompt, taskState, history, window } = input;

  // The facts block — same as you had in index.ts
  const facts = Object.entries(taskState)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const system = facts
    ? `${systemPrompt}\n\nWhat you know about this user:\n${facts}`
    : systemPrompt;

  // The window — same as you had in index.ts
  const messages = window <= 0 ? [] : history.slice(-window);

  return { system, messages };
}