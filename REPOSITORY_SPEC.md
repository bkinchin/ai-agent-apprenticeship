# AI Agent Engineering Apprenticeship

# Repository Specification

## Mission

Create a GitHub repository called:

`ai-agent-apprenticeship`

This repository is a 21-day intensive apprenticeship designed to teach enterprise AI agent engineering.

The learner's goal is to become capable of designing, building, evaluating and deploying production-quality AI agents.

The final outcome is not a collection of tutorials.

The final outcome is:

1. A deep understanding of agent architecture.
2. A portfolio of working AI agents.
3. A production-style Agent Factory platform.
4. The ability to discuss agent design at an enterprise engineering level.

---

# Learner Profile

The learner has:

* strong product management experience
* engineering leadership experience
* enterprise software experience
* customer-facing technology experience

The learner is not trying to become a junior software engineer.

The learner is becoming:

* AI Product Architect
* Applied AI Engineer
* Enterprise Agent Designer

Teach systems thinking.

Do not optimise only for coding speed.

---

# Repository Philosophy

The repository should teach:

## First principles

Before frameworks.

The learner must understand:

* what an agent is
* why agents need state
* why tools exist
* why evaluation matters
* why policies matter
* why reliability is difficult

## Production thinking

Every project must include:

* requirements
* architecture
* implementation
* tests
* evaluation
* failure analysis
* improvement plan

## Business relevance

Projects should represent real enterprise use cases.

Avoid toy examples.

---

# Repository Structure

Create:

```
ai-agent-apprenticeship/

README.md

CLAUDE.md

REPOSITORY_SPEC.md

SUCCESS_CRITERIA.md


curriculum/

    week-01/
        day-01.md
        day-02.md
        day-03.md
        day-04.md
        day-05.md
        day-06.md
        day-07.md

    week-02/
        day-08.md
        day-09.md
        day-10.md
        day-11.md
        day-12.md
        day-13.md
        day-14.md

    week-03/
        day-15.md
        day-16.md
        day-17.md
        day-18.md
        day-19.md
        day-20.md
        day-21.md


projects/

    01-hello-agent/

    02-subscription-cancellation-agent/

    03-golf-club-agent/

    04-agent-factory/


shared/

    prompts/

    tools/

    evaluation/

    memory/

    policies/


docs/

    architecture/

    diagrams/

    interview-preparation/

    reading/


templates/

    PRD_TEMPLATE.md

    ARCHITECTURE_TEMPLATE.md

    POLICY_TEMPLATE.md

    EVALUATION_TEMPLATE.md


journal/

```

---

# Technology Choices

Use:

## Primary language

TypeScript.

Reason:

* strong enterprise adoption
* excellent AI ecosystem
* aligns with modern product engineering

## Initial stack

Start simple.

Use:

* Node.js
* TypeScript
* OpenAI API
* Zod
* SQLite

Do NOT introduce initially:

* Docker
* Kubernetes
* LangGraph
* vector databases
* complex infrastructure

The learner must understand fundamentals first.

---

# Framework Philosophy

Frameworks are implementation choices.

The learner must understand concepts before adopting tools.

Introduce later:

* LangGraph
* OpenAI Agents SDK
* MCP
* RAG frameworks
* vector databases

The learner should be able to answer:

"Why use this framework?"

not:

"How do I use this framework?"

---

# Final Projects

## Project 1

# Hello Agent

Purpose:

Understand the basic LLM interaction model.

Learn:

* messages
* prompts
* responses
* conversation history

---

## Project 2

# Subscription Cancellation Agent

Purpose:

Learn production agent fundamentals.

Capabilities:

* understand user intent
* verify customer
* inspect subscription
* offer retention
* cancel subscription
* confirm result

Must include:

* tools
* state
* policies
* evaluations

---

## Project 3

# Golf Club Agent

Purpose:

Build a realistic enterprise vertical agent.

Scenario:

An AI receptionist for a golf club.

Capabilities:

Membership:

* membership questions
* fees
* renewals

Operations:

* tee bookings
* competition information
* events

Customer service:

* complaints
* requests
* escalation

Must include:

* knowledge retrieval
* tools
* memory
* policies
* evaluation

---

## Project 4

# Agent Factory

Final project.

Build a system that generates agents.

Input:

```
Business type

Customer jobs

Available systems

Required tools

Policies

Success metrics
```

Output:

```
agent/

    system_prompt.md

    goals.yaml

    policies.yaml

    tools/

    knowledge/

    evaluations/

    README.md
```

The goal:

Generate a new business agent quickly.

---

# Curriculum Structure

Each day must contain:

```
# Day X

## Objective

What will be learned.

## Concepts

Theory.

## Architecture

How this works in production.

## Exercise

Hands-on task.

## Deliverable

What should exist afterwards.

## Reflection

Questions to answer.

## Interview Question

A Sierra-style interview question.
```

---

# 21 Day Curriculum

## Week 1

Foundation.

Day 1:
What is an AI Agent?

Day 2:
Conversation state.

Day 3:
Tool calling.

Day 4:
Structured outputs.

Day 5:
Workflow design.

Day 6:
Policies and guardrails.

Day 7:
Evaluation.

---

## Week 2

Enterprise agent.

Day 8:
Product requirements and jobs-to-be-done.

Day 9:
Knowledge systems.

Day 10:
Business tools.

Day 11:
Memory.

Day 12:
Human escalation.

Day 13:
Observability.

Day 14:
Production review.

---

## Week 3

Agent platform.

Day 15:
Agent architecture patterns.

Day 16:
Multi-step planning.

Day 17:
Agent generation.

Day 18:
Agent evaluation engine.

Day 19:
Agent improvement loop.

Day 20:
Production deployment.

Day 21:
Final demo and interview preparation.

---

# Claude Code Behaviour

Create a CLAUDE.md file.

Claude Code should act as:

"Principal AI Engineer Mentor"

Rules:

* teach before coding
* ask architecture questions
* challenge assumptions
* explain tradeoffs
* review implementations
* avoid unnecessary complexity

Claude should not:

* dump code without explanation
* introduce frameworks unnecessarily
* optimise for speed over understanding

---

# Quality Standards

Every implementation must have:

## Documentation

README explaining:

* purpose
* architecture
* usage

## Tests

Include:

* unit tests
* workflow tests
* agent behaviour tests

## Evaluation

Define:

* success metrics
* failure cases
* quality criteria

## Reflection

Document:

* what worked
* what failed
* what would improve in production

---

# Success Criteria

At completion the learner should be able to:

Explain:

* what makes an agent different from a chatbot
* how agents use tools
* how state works
* how memory works
* how evaluation works
* how policies work
* how agents improve

Build:

* production-style agents
* business workflows
* evaluation systems
* an agent generator

Discuss confidently:

* enterprise AI architecture
* agent reliability
* human-in-the-loop systems
* AI governance
* business applications of agents

---

# Final Instruction

Create the repository.

Populate all folders.

Create the curriculum files.

Create templates.

Create starter code.

Do not attempt to finish all implementations immediately.

Build the apprenticeship progressively.

The learner should complete the work day-by-day.
