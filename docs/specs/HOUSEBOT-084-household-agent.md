# Household Agent: tool-calling assistant replacing the topic-processor pipeline

## Summary

Replace the single-shot LLM route classifier (`topic-processor.ts`) and the scattered
LLM reply surfaces (group branch of `dm-assistant.ts`, `openai-chat-assistant.ts` group
usage) with one agent: a wake gate that decides whether the bot should react at all,
and a tool-calling loop that answers questions from real data and performs household
actions only through gated tools. The bot talks freely when addressed, stays silent
when household members talk to each other, never fabricates state, and can record,
edit, and cancel payments and purchases via confirmation cards.

## Goals

- Silent by default in group topics; wakes on explicit mention, reply-to-bot,
  active workflow, text address ("бот", "Кожур"), or a completed payment/purchase
  fact in the matching workflow topic.
- Answers everything `/bill`-family commands can answer, from live dashboard data.
- Understands "оплатил за себя и за Алису" (multi-member payment proposal with
  per-member amounts) and "Ион оплатил аренду" (third-person payer).
- Payments: propose, confirm, cancel, edit amount, delete — writes to saved records
  gated by confirmation cards.
- Purchases: propose, confirm, cancel, edit, delete, update participants.
- Knows household settings, billing periods, due dates, payment destinations, its
  own capabilities and the command catalog.
- All state-changing or state-describing text comes from fixed locale strings or
  tool results — never free LLM prose.

## Non-goals

- DM assistant rework (follow-up; DM flow keeps its current pipeline).
- Reminders-topic utility entry and ad-hoc notification flows (kept as-is; agent
  is the fallback chat surface in those topics).
- Anonymous feedback flow (kept).
- New persistence layer; memory stays in-process.

## Scope

- In: new `wake-gate.ts`, `openai-tool-session.ts`, `agent-tools.ts`,
  `agent-confirmations.ts`, `household-agent.ts`; rewiring `app.ts`; deletion of
  `topic-processor.ts`, message-routing middleware inside
  `payment-topic-ingestion.ts` / `purchase-topic-ingestion.ts` (callback handlers
  and proposal builders remain), group branch of `dm-assistant.ts`,
  engagement heuristics in `conversation-orchestrator.ts`.
- Out: mini app, scheduler, miniapp API surfaces.

## Interfaces and Contracts

### Wake gate

```
assessWake({ctx-ish flags, topicRole, senderPendingAction, recentThreadMessages, messageText})
  -> { wake: boolean, reason: 'mention' | 'reply' | 'workflow' | 'classifier' | 'silent' }
```

Deterministic first (mention/reply/workflow). Otherwise one binary LLM call
(assistant model): given topic role and last ~6 thread messages, return
`{ addressedToBot: boolean, householdFact: 'payment' | 'purchase' | null }`.
`householdFact` wakes only in the matching workflow topic. Messages between
humans → silent; no weak sessions, no regex triggers.

### Agent loop

OpenAI Responses API with `tools` (function calling), max 6 iterations,
`assistantModel`. Read tools return compact JSON; write tools perform their side
effect (post a proposal/confirmation card via existing builders) and return a
status object. When a write tool posted a card, the runtime suppresses additional
agent prose.

### Tools

Reads (wrap `FinanceCommandService` + settings):

- `get_bill_status` — dashboard summary: period, stage, totals, due dates,
  per-member remaining per kind.
- `get_payment_instructions` — rent destinations, utility categories with
  provider/link, per-member amounts due now.
- `get_household_info` — billing settings, members + statuses, topics, command
  catalog, agent capabilities.
- `list_ledger` — recent payments/purchases with ids (for edit/delete targeting).

Writes:

- `propose_payment {kind?, payerMemberId?, memberIds?, amountMajor?, currency?}` →
  `maybeCreatePaymentProposalFromCandidate` (extended with explicit `memberIds`),
  existing single/multi cards + callbacks.
- `propose_purchase {description, amountMajor, currency?, payerMemberId?,
participantMemberIds?}` → `saveWithInterpretation`, existing purchase card.
- `update_payment / delete_payment / update_purchase / delete_purchase /
set_purchase_participants {id, ...}` → generic `agent_action` confirmation card;
  executes via `FinanceCommandService` on confirm.
- `cancel_pending_proposal` — clears sender's pending payment proposal/clarification.

### Confirmation cards

New pending action type `agent_action` (ports union extended), payload
`{actionType, params, summaryText}`, 30-min TTL, callbacks
`agent:confirm:<id>` / `agent:cancel:<id>`. Only the initiating sender or an
admin may press. Executes through `FinanceCommandService`, replies with fixed
locale strings, emits audit events.

## Domain Rules

- Money in minor units end to end; amounts parsed by code, not by the model:
  an explicit amount is trusted only if the exact amount+currency appears in the
  raw message text (reuse `validatedCurrentMessageAmount` semantics).
- Proposal amounts default to member guidance (`buildMemberPaymentGuidance`);
  multi-member confirm re-derives amounts from the live dashboard (existing
  behavior preserved).
- The agent never asserts completed actions; only callback handlers report
  saved/cancelled state.
- The agent never consents/commits on behalf of members.

## Security and Privacy

- Tools resolve the sender to a household member; non-members get no tools.
- Write tools validate target ownership (payer/sender/admin) before creating cards.
- Rate limiting and usage tracking reuse `assistant-state.ts` primitives.

## Observability

- Log wake decisions (`agent.wake`), tool calls with args (`agent.tool`),
  loop outcomes (`agent.reply`, `agent.silent`), and failures.

## Edge Cases and Failure Modes

- OpenAI failure/timeouts → stay silent in group (no error spam); log.
- Tool throwing → tool returns error status to the model; model apologizes briefly.
- Ambiguous member names → tool returns candidate list; model asks one short question.
- Unsupported currency stays a fixed-string reply (existing behavior).

## Test Plan

- Unit: wake gate (deterministic branches, classifier mocking), tool handlers
  (guards, member resolution, amount validation), confirmation card lifecycle,
  tool-session loop against a fake fetch.
- Regression fixtures from real transcripts:
  - "Оплатил за себя и за иона" → multi-member proposal card (never "отменено").
  - "Так, сегодня надо бы дооплатить" → no proposal, no save.
  - Human-to-human "Давай я твою долю оплачу…" → silent.
  - "А как мне оплачивать и что?" (mention) → instructions from
    `get_payment_instructions`, no invented facts.
  - "Ион оплатил аренду" → third-person proposal for Ion.

## Acceptance Criteria

- [ ] Topic processor deleted; no `TOPIC_PROCESSOR_MODEL` config.
- [ ] Group messages in bound topics flow through wake gate + agent only.
- [ ] All writes gated by cards; no direct saves from free text.
- [ ] Quality gates pass.

## Rollout Plan

- Single household deployment; no flag. Backout = git revert.
