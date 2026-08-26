# Household Facts: a shared knowledge base the agent can read and edit

## Summary

Give the household agent a small, structured knowledge base so it can answer
"какой пароль от wifi", "когда вывозят мусор", "как зовут лендлорда" from stored
household facts instead of guessing or falling back to "I don't know". Facts live
in their own table, are read on demand through a tool, and can be taught to the bot
from chat behind the existing confirmation card gate.

Today the only place for such knowledge is `households.assistant_context` — a single
1200-character blob, editable only in the mini app, injected into every prompt. It
does not scale, cannot be edited per fact, has no audit trail, and cannot be written
from chat.

## Goals

- The agent answers household questions from stored facts and never invents one.
- Facts are retrieved on demand, so the system prompt grows by a fixed short index
  line rather than by the size of the knowledge base.
- Any member can teach the bot a fact from chat ("бот, запомни: пароль от вайфая X"),
  gated by the existing `agent_action` confirmation card.
- Facts can be corrected and deleted through the same gate.
- Admins can manage facts in the mini app settings sheet.
- Every fact write is audited like other agent actions.

## Non-goals

- Embeddings / vector search. A household holds tens of facts, not thousands; the
  whole fact index fits in one tool result. Revisit past ~100 facts.
- Per-fact access control or secret handling. Facts are shared household knowledge
  and are sent to the model like any other tool result (explicit user decision).
- Replacing `assistant_context` / `assistant_tone`. Context stays for standing
  background and personality; facts hold discrete, answerable knowledge.
- File or image attachments on facts.

## Scope

- In: `household_facts` table, `HouseholdFactsRepository` port methods on
  `HouseholdConfigurationRepository`, DB adapter, agent read/write tools, the
  prompt fact index, `set_household_fact` / `delete_household_fact` confirmation
  actions, mini app admin CRUD.
- Out: scheduler, reminders, purchase/payment flows, wake gate.

## Interfaces and Contracts

### Port (added to `HouseholdConfigurationRepository`)

```
listHouseholdFacts(householdId): Promise<readonly HouseholdFactRecord[]>
upsertHouseholdFact(input: {
  householdId, key, title, body, updatedByMemberId?
}): Promise<HouseholdFactRecord>
deleteHouseholdFact(householdId, key): Promise<boolean>
```

```
HouseholdFactRecord {
  id, householdId, key, title, body,
  updatedByMemberId: string | null,
  createdAt: Instant, updatedAt: Instant
}
```

Methods are optional on the port (like `getHouseholdAssistantConfig`) so partial
adapters keep type-checking; the agent degrades to "no facts" when absent.

### Agent tools

Read:

- `get_household_facts { keys?: string[] }` — returns every fact's key, title and
  body when `keys` is omitted, or only the requested keys. Truncates bodies to a
  total budget and reports `truncated: true` when it does.

Writes (confirmation card, new `AgentActionType`s):

- `set_household_fact { key, title, body }` — posts an `agent_action` card
  summarising create-or-update; writes on confirm.
- `delete_household_fact { key }` — posts a card; deletes on confirm.

Card resolution follows the existing rule: the requester or any admin may press.

### Prompt

`buildHouseholdAgentContext` adds one line when facts exist:

```
Known household facts (call get_household_facts for the answer): wifi, мусор, лендлорд
```

Keys and titles only. The model must call the tool to get a body; it may never
answer a fact question from the index alone.

### Mini app

`POST /api/miniapp/admin/settings` gains `facts: [{key, title, body, updatedAt}]`.
`POST /api/miniapp/admin/facts/upsert` stores one fact,
`POST /api/miniapp/admin/facts/delete` removes one. Admin only, same auth path as the
utility-category handler. Both invalidate the agent's household context cache.

## Domain Rules

- `key` is a slug: lowercase, `[a-z0-9-]`, 1–48 chars, unique per household.
  Non-ASCII titles are fine; the key is derived from the title when the model omits
  it, and rejected if it cannot be slugged.
- `title` ≤ 120 chars, `body` ≤ 2000 chars, both trimmed; empty body is rejected.
- A household holds at most 100 facts; further `set_household_fact` calls are
  rejected with `fact_limit_reached`.
- Facts never override accounting data. When a fact contradicts a tool-backed
  number (rent, balances, due dates), the financial tool wins.
- The agent never asserts a fact was saved; only the card callback reports that.

## Data Model Changes

New table:

```sql
create table household_facts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  key text not null,
  title text not null,
  body text not null,
  updated_by_member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index household_facts_household_key_unique on household_facts (household_id, key);
```

Migration generated with `bun run db:generate`; checksum manifest updated.

## Security and Privacy

- Only resolved household members reach agent tools, so only members read facts.
- Writes are gated by a confirmation card; the requester or an admin confirms.
- Fact bodies are sent to OpenAI as tool results when a fact question is asked.
  Accepted deliberately: facts are shared household knowledge, not credentials
  belonging to individuals.
- Mini app fact handlers require admin.

## Observability

- `agent.tool` already logs tool name and args; fact writes additionally emit an
  audit event `agent.set_household_fact` / `agent.delete_household_fact` under the
  `period_events` category.
- Log fact-index cache misses through the existing household context cache.

## Edge Cases and Failure Modes

- Unknown key in `get_household_facts` → the key is reported in `missing`, other
  keys still return.
- No facts stored → tool returns `{ facts: [] }`; the prompt omits the index line;
  the agent says it does not know and offers to remember the answer.
- `set_household_fact` on an existing key → card summary says "update" and shows the
  old body so the confirmer sees what is being replaced.
- Repository lacking the optional methods → tools are not registered at all.
- Fact write confirmed after the fact was deleted elsewhere → upsert recreates it;
  delete of a missing key returns `false` and the card reports failure.

## Test Plan

- Unit: slug/limit validation (`packages/domain`), `get_household_facts` shaping and
  missing keys, `set_household_fact` / `delete_household_fact` card creation and guards,
  `executeAgentAction` fact branches, fact index line in the agent context, mini app
  fact handlers (admin guard, slug rejection, cache invalidation).
- Integration: adapter upsert/list/delete, skipped without `DATABASE_URL`.
- E2E: none.

## Acceptance Criteria

- [ ] "какой пароль от вайфая" answers from a stored fact, via a tool call.
- [ ] "бот, запомни: ..." posts a confirmation card and stores on confirm.
- [ ] Facts are not injected wholesale into the system prompt.
- [ ] Admins can add, edit and delete facts in the mini app.
- [ ] Quality gates pass.

## Rollout Plan

- Single household deployment; no flag. Migration is additive; backout = git revert
  plus `drop table household_facts`.
