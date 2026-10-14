import { Check, HandCoins, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { executeRepayment, type Repayment, type RepaymentCommand } from '@/api/repayments'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatFriendlyDate } from '@/lib/dates'
import { majorStringToMinor, minorToMajorString, parseMoneyInput } from '@/lib/money'
import { haptics } from '@/telegram/webapp'

type Editor = { kind: 'transfer'; requestId?: string; to?: string } | { kind: 'request' }

/**
 * Paying a housemate back directly: record money you sent (it counts once they
 * confirm), confirm money you received, or ask to be paid back when you are owed.
 */
export function SettleUp({ startWithTransfer = false }: { startWithTransfer?: boolean }) {
  const { initData, readySession, handleMiniAppRequestError } = useSession()
  const { dashboard, currentMemberLine, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()
  const meId = readySession?.member.id
  const live = readySession?.mode === 'live'
  const [records, setRecords] = useState<Repayment[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(
    startWithTransfer && live ? { kind: 'transfer' } : null
  )
  const currency = dashboard?.currency ?? 'GEL'
  const balance = majorStringToMinor(currentMemberLine?.purchaseOffsetMajor ?? '0.00')
  const credit = balance < 0n ? -balance : 0n
  const name = (id: string | null) =>
    dashboard?.members.find((member) => member.memberId === id)?.displayName ?? '—'
  const money = (minor: bigint | string, code = currency) =>
    formatMoney(
      typeof minor === 'string' ? minorToMajorString(BigInt(minor)) : minorToMajorString(minor),
      code
    )

  async function load() {
    if (!initData || !live) return
    setLoadFailed(false)
    try {
      setRecords(await executeRepayment(initData, { action: 'list' }))
    } catch (error) {
      if (!handleMiniAppRequestError(error)) setLoadFailed(true)
    }
  }

  useEffect(() => {
    void load()
    // Load once per session; every action below returns the fresh list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData, live])

  async function run(key: string, command: RepaymentCommand): Promise<boolean> {
    if (!initData || busy) return false
    setBusy(key)
    try {
      setRecords(await executeRepayment(initData, command))
      showToast(copy.settleSaved, 'success')
      await refresh()
      return true
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.settleFailed, 'error')
      return false
    } finally {
      setBusy(null)
    }
  }

  const incoming = records.filter(
    (record) =>
      record.kind === 'transfer' && record.status === 'pending' && record.toMemberId === meId
  )
  const outgoing = records.filter(
    (record) =>
      record.kind === 'transfer' && record.status === 'pending' && record.fromMemberId === meId
  )
  const requests = records.filter((record) => record.kind === 'request' && record.status === 'open')
  const earlier = records
    .filter((record) => record.status !== 'pending' && record.status !== 'open')
    .slice()
    .reverse()
    .slice(0, 8)
  const received = (request: Repayment) =>
    records
      .filter((record) => record.requestId === request.id && record.status === 'confirmed')
      .reduce((sum, record) => sum + BigInt(record.amountMinor), 0n)

  return (
    <section className="rounded-[24px] bg-card p-4">
      <h3 className="text-[15px] font-semibold">{copy.settleTitle}</h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {live ? copy.settleBody : copy.settleDemo}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!live}
          onClick={() => setEditor({ kind: 'transfer' })}
        >
          <Send className="size-3.5" />
          {copy.settleSent}
        </Button>
        {credit > 0n ? (
          <Button size="sm" disabled={!live} onClick={() => setEditor({ kind: 'request' })}>
            <HandCoins className="size-3.5" />
            {copy.settleAsk}
          </Button>
        ) : null}
      </div>

      {loadFailed ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-danger" role="alert">
          {copy.settleLoadFailed}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            {copy.settleRetry}
          </button>
        </p>
      ) : null}

      {incoming.length + outgoing.length + requests.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {incoming.map((record) => (
            <li key={record.id} className="rounded-2xl bg-buys-soft p-3 text-buys-ink">
              <p className="text-sm font-semibold">
                {copy.settleIncoming
                  .replace('{name}', name(record.fromMemberId))
                  .replace('{amount}', money(record.amountMinor, record.currency))}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === `confirm:${record.id}`}
                  onClick={() =>
                    void run(`confirm:${record.id}`, { action: 'confirm', id: record.id })
                  }
                >
                  <Check className="size-3.5" strokeWidth={3} />
                  {copy.settleConfirm}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `cancel:${record.id}`}
                  onClick={() =>
                    void run(`cancel:${record.id}`, { action: 'cancel', id: record.id })
                  }
                >
                  {copy.settleCancel}
                </Button>
              </div>
            </li>
          ))}
          {outgoing.map((record) => (
            <li key={record.id} className="flex items-center gap-3 rounded-2xl bg-elevated p-3">
              <Avatar name={name(record.toMemberId)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold tabular-nums">
                  {money(record.amountMinor, record.currency)}
                </span>
                <span className="block truncate text-xs text-faint">
                  {copy.settleOutgoing.replace('{name}', name(record.toMemberId))}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === `cancel:${record.id}`}
                onClick={() => void run(`cancel:${record.id}`, { action: 'cancel', id: record.id })}
              >
                {copy.settleCancel}
              </Button>
            </li>
          ))}
          {requests.map((request) => {
            const got = received(request)
            const left = BigInt(request.amountMinor) - got
            const mine = request.toMemberId === meId
            return (
              <li key={request.id} className="rounded-2xl bg-elevated p-3">
                <p className="text-sm font-semibold">
                  {mine
                    ? copy.settleRequestMine
                    : copy.settleRequestOther.replace('{name}', name(request.toMemberId))}
                  {' · '}
                  <span className="tabular-nums">
                    {money(request.amountMinor, request.currency)}
                  </span>
                </p>
                <p className="text-xs text-faint">
                  {copy.settleRequestProgress
                    .replace('{received}', money(got, request.currency))
                    .replace('{total}', money(request.amountMinor, request.currency))}
                </p>
                <div className="mt-2">
                  {mine ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `close:${request.id}`}
                      onClick={() =>
                        void run(`close:${request.id}`, { action: 'close', id: request.id })
                      }
                    >
                      {copy.settleCloseRequest}
                    </Button>
                  ) : left > 0n ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        setEditor({
                          kind: 'transfer',
                          requestId: request.id,
                          to: request.toMemberId
                        })
                      }
                    >
                      {copy.settlePayPart}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {earlier.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-1 text-[13px] font-semibold text-muted-foreground">
            {copy.settleEarlier}
          </h4>
          <ul className="divide-y divide-border">
            {earlier.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {record.kind === 'request'
                    ? copy.settleRequestOther.replace('{name}', name(record.toMemberId))
                    : `${name(record.fromMemberId)} → ${name(record.toMemberId)}`}
                  <span className="text-xs text-faint">
                    {' · '}
                    {formatFriendlyDate(record.occurredOn, locale)} ·{' '}
                    {record.status === 'confirmed'
                      ? copy.settleStatusConfirmed
                      : record.status === 'cancelled'
                        ? copy.settleStatusCancelled
                        : copy.settleStatusClosed}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {money(record.amountMinor, record.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editor ? (
        <SettleEditor
          editor={editor}
          credit={credit}
          balance={balance}
          busy={busy !== null}
          onOpenChange={(open) => !open && setEditor(null)}
          onSubmit={async (command) => {
            if (await run('editor', command)) setEditor(null)
          }}
        />
      ) : null}
    </section>
  )
}

function SettleEditor({
  editor,
  credit,
  balance,
  busy,
  onOpenChange,
  onSubmit
}: {
  editor: Editor
  credit: bigint
  balance: bigint
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (command: RepaymentCommand) => Promise<void>
}) {
  const { copy } = useI18n()
  const { readySession } = useSession()
  const { dashboard } = useDashboard()
  const currency = dashboard?.currency ?? 'GEL'
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: dashboard?.timezone ?? 'Asia/Tbilisi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
  const [amount, setAmount] = useState(editor.kind === 'request' ? minorToMajorString(credit) : '')
  const [to, setTo] = useState(editor.kind === 'transfer' ? (editor.to ?? '') : '')
  const [date, setDate] = useState(today)
  // One id per distinct submission, reused on retry so the server can drop duplicates.
  const attempt = useRef<{ key: string; id: string } | null>(null)
  const amountMinor = parseMoneyInput(amount)
  const valid =
    amountMinor > 0n &&
    (editor.kind === 'request' ? amountMinor <= credit : Boolean(to) && date <= today)
  const after = balance - amountMinor

  function submit() {
    if (!valid || busy) return
    const key = JSON.stringify({ editor, amount, to, date })
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() }
    const id = attempt.current.id
    void onSubmit(
      editor.kind === 'request'
        ? { action: 'request', id, amountMajor: amount }
        : {
            action: 'transfer',
            id,
            toMemberId: to,
            amountMajor: amount,
            occurredOn: date,
            ...(editor.requestId ? { requestId: editor.requestId } : {})
          }
    )
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={editor.kind === 'request' ? copy.settleRequestTitle : copy.settleTransferTitle}
      description={editor.kind === 'request' ? copy.settleRequestHint : copy.settleTransferHint}
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={!valid}
          onClick={submit}
        >
          {editor.kind === 'request' ? copy.settleCreateRequest : copy.settleSendForConfirm}
        </Button>
      }
    >
      <div className="space-y-3">
        {editor.kind === 'transfer' ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-muted-foreground">
              {copy.settleTo}
            </h3>
            <div className="flex flex-wrap gap-2">
              {(dashboard?.members ?? [])
                .filter(
                  (member) =>
                    member.memberId !== readySession?.member.id && member.status !== 'left'
                )
                .map((member) => {
                  const active = member.memberId === to
                  return (
                    <button
                      key={member.memberId}
                      type="button"
                      disabled={Boolean(editor.requestId)}
                      aria-pressed={active}
                      onClick={() => {
                        haptics.selection()
                        setTo(member.memberId)
                      }}
                      className={cn(
                        'flex h-10 items-center gap-2 rounded-full pl-1 pr-3.5 text-sm font-medium transition-colors disabled:opacity-60',
                        active ? 'bg-buys-soft text-buys-ink' : 'bg-elevated text-muted-foreground'
                      )}
                    >
                      <Avatar
                        name={member.displayName}
                        className={cn('size-8 text-[11px]', active && 'bg-buys text-white')}
                      />
                      {member.displayName}
                    </button>
                  )
                })}
            </div>
          </section>
        ) : null}

        <AmountInput
          label={copy.formAmount}
          value={amount}
          currency={currency}
          autoFocus
          onChange={setAmount}
          footer={
            editor.kind === 'request' ? (
              <p className="text-xs text-faint">
                {copy.settleRequestMax.replace(
                  '{amount}',
                  formatMoney(minorToMajorString(credit), currency)
                )}
              </p>
            ) : amountMinor > 0n ? (
              <p className="text-xs text-faint">
                {copy.settleAfter.replace(
                  '{balance}',
                  after > 0n
                    ? copy.settleAfterOwe.replace(
                        '{amount}',
                        formatMoney(minorToMajorString(after), currency)
                      )
                    : after < 0n
                      ? copy.settleAfterOwed.replace(
                          '{amount}',
                          formatMoney(minorToMajorString(-after), currency)
                        )
                      : copy.settleAfterEven
                )}
              </p>
            ) : null
          }
        />

        {editor.kind === 'transfer' ? (
          <Field label={copy.settleWhen}>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </Sheet>
  )
}
