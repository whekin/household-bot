import { ArrowRightLeft, HandCoins } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { executeRepayment, type Repayment, type RepaymentCommand } from '@/api/repayments'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/dialog'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'

export function RepaymentsSection() {
  const { initData, readySession, handleMiniAppRequestError } = useSession()
  const { dashboard, currentMemberLine, refresh } = useDashboard()
  const { locale } = useI18n()
  const { showToast } = useToast()
  const ru = locale === 'ru'
  const memberId = readySession?.member.id
  const live = readySession?.mode === 'live'
  const [records, setRecords] = useState<Repayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<'request' | 'transfer' | null>(null)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [requestId, setRequestId] = useState<string | undefined>()
  const [date, setDate] = useState('')
  const retry = useRef<{ key: string; id: string } | null>(null)
  const currency = dashboard?.currency ?? 'GEL'
  const offset = majorStringToMinor(currentMemberLine?.purchaseOffsetMajor ?? '0')
  const credit = offset < 0n ? -offset : 0n
  const money = (minor: bigint, code = currency) =>
    formatMoneyLabel(minorToMajorString(minor), code, locale)
  const name = (id: string | null) =>
    dashboard?.members.find((member) => member.memberId === id)?.displayName ?? '—'
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: dashboard?.timezone ?? 'Asia/Tbilisi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())

  useEffect(() => {
    if (!initData || !live) return
    let active = true
    executeRepayment(initData, { action: 'list' })
      .then((result) => {
        if (active) setRecords(result)
      })
      .catch((err) => {
        if (active && !handleMiniAppRequestError(err))
          setError(err instanceof Error ? err.message : 'Unable to load repayments')
      })
    return () => {
      active = false
    }
  }, [initData, live, handleMiniAppRequestError])

  async function run(command: RepaymentCommand) {
    if (!initData || busy) return
    setBusy(true)
    setError(null)
    try {
      setRecords(await executeRepayment(initData, command))
      if (command.action !== 'list') {
        setEditor(null)
        retry.current = null
        showToast(ru ? 'Сохранено' : 'Saved', 'success')
        await refresh()
      }
    } catch (err) {
      if (!handleMiniAppRequestError(err))
        setError(err instanceof Error ? err.message : 'Unable to save repayment')
    } finally {
      setBusy(false)
    }
  }

  function open(kind: 'request' | 'transfer', request?: Repayment) {
    retry.current = null
    setEditor(kind)
    setAmount(kind === 'request' ? minorToMajorString(credit) : '')
    setRecipient(request?.toMemberId ?? '')
    setRequestId(request?.id)
    setDate(today)
    setError(null)
  }
  let amountMinor = 0n
  try {
    amountMinor = majorStringToMinor(amount)
  } catch {
    /* An incomplete draft is not submittable. */
  }
  const valid =
    amountMinor > 0n &&
    (editor === 'request' ? amountMinor <= credit : Boolean(recipient && date && date <= today))
  const balanceText = (value: bigint) =>
    value < 0n
      ? `${ru ? 'Вам должны' : 'You are owed'} ${money(-value)}`
      : `${ru ? 'Вы должны' : 'You owe'} ${money(value)}`
  function save() {
    if (!editor || !valid) return
    const key = JSON.stringify({ editor, amount, recipient, date, requestId })
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }
    const id = retry.current.id
    void run(
      editor === 'request'
        ? { action: 'request', id, amountMajor: amount }
        : {
            action: 'transfer',
            id,
            toMemberId: recipient,
            amountMajor: amount,
            occurredOn: date,
            ...(requestId ? { requestId } : {})
          }
    )
  }
  const status = {
    pending: ru ? 'Ожидает подтверждения' : 'Awaiting receipt',
    confirmed: ru ? 'Получено' : 'Received',
    cancelled: ru ? 'Отменено' : 'Cancelled',
    open: ru ? 'Открыт' : 'Open',
    closed: ru ? 'Закрыт' : 'Closed'
  }

  return (
    <Card>
      <CardHeader
        title={ru ? 'Возврат денег' : 'Repayments'}
        action={<ArrowRightLeft className="size-4 text-muted-foreground" />}
      />
      <p className="mb-3 text-sm text-muted-foreground">
        {ru
          ? 'Верните часть баланса напрямую — удобной суммой, в любое время.'
          : 'Settle part of your balance directly, with an amount you can afford.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!live || busy} onClick={() => open('transfer')}>
          <HandCoins className="size-4" />
          {ru ? 'Я перевёл деньги' : 'Record money sent'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!live || busy || credit <= 0n}
          onClick={() => open('request')}
        >
          {ru ? 'Попросить возврат' : 'Request repayment'}
        </Button>
      </div>
      {error && !editor ? (
        <div role="alert" className="mt-3 text-sm text-destructive">
          {error}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run({ action: 'list' })}
          >
            {ru ? 'Обновить' : 'Refresh'}
          </Button>
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {records
          .filter((record) => record.kind === 'request' && record.status === 'open')
          .map((request) => {
            const received = records
              .filter((record) => record.requestId === request.id && record.status === 'confirmed')
              .reduce((sum, record) => sum + BigInt(record.amountMinor), 0n)
            const remaining = BigInt(request.amountMinor) - received
            return (
              <div
                key={request.id}
                className="rounded-xl border border-border bg-surface px-3 py-3"
              >
                <p className="text-sm font-medium">
                  {name(request.toMemberId)} ·{' '}
                  {money(BigInt(request.amountMinor), request.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ru ? 'Получено' : 'Received'} {money(received, request.currency)} ·{' '}
                  {ru ? 'Осталось' : 'Remaining'}{' '}
                  {money(remaining > 0n ? remaining : 0n, request.currency)}
                </p>
                <div className="mt-2">
                  {request.toMemberId === memberId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run({ action: 'close', id: request.id })}
                    >
                      {ru ? 'Закрыть запрос' : 'Close request'}
                    </Button>
                  ) : remaining > 0n ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => open('transfer', request)}
                    >
                      {ru ? 'Перевести часть' : 'Record a contribution'}
                    </Button>
                  ) : (
                    <span className="text-xs text-status-credit">
                      {ru ? 'Собрано' : 'Fulfilled'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        {records
          .filter((record) => record.kind === 'transfer' || record.status === 'closed')
          .slice()
          .reverse()
          .map((record) => (
            <div key={record.id} className="border-t border-border pt-3">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {record.kind === 'request'
                    ? name(record.toMemberId)
                    : `${name(record.fromMemberId)} → ${name(record.toMemberId)}`}
                </span>
                <span className="shrink-0 font-mono">
                  {money(BigInt(record.amountMinor), record.currency)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {record.occurredOn} · {status[record.status]}
                {record.kind === 'request' ? (ru ? ' · Запрос' : ' · Request') : ''}
              </p>
              {record.status === 'pending' &&
              (record.fromMemberId === memberId || record.toMemberId === memberId) ? (
                <div className="mt-2 flex gap-2">
                  {record.toMemberId === memberId ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run({ action: 'confirm', id: record.id })}
                    >
                      {ru ? 'Деньги получены' : 'Confirm money received'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run({ action: 'cancel', id: record.id })}
                  >
                    {ru ? 'Отменить' : 'Cancel'}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
      </div>
      <Sheet
        open={editor !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setEditor(null)
        }}
        title={
          editor === 'request'
            ? ru
              ? 'Попросить возврат'
              : 'Request repayment'
            : ru
              ? 'Записать перевод'
              : 'Record transfer'
        }
        footer={
          <Button className="w-full" disabled={busy || !valid} onClick={save}>
            {busy
              ? ru
                ? 'Сохранение…'
                : 'Saving…'
              : editor === 'request'
                ? ru
                  ? 'Создать запрос'
                  : 'Create request'
                : ru
                  ? 'Отправить на подтверждение'
                  : 'Ask recipient to confirm'}
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {editor === 'request'
              ? ru
                ? 'Участники смогут вернуть любую часть суммы. Запрос не меняет баланс.'
                : 'Housemates can repay any part of this amount. The request does not change balances.'
              : ru
                ? 'Записывайте только уже отправленные деньги. Балансы изменятся после подтверждения получателем.'
                : 'Record money you have already sent. Balances change when the recipient confirms receipt.'}
          </p>
          {editor === 'transfer' ? (
            <Field label={ru ? 'Кому' : 'Recipient'}>
              <Select
                disabled={busy || Boolean(requestId)}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">{ru ? 'Выберите участника' : 'Choose a housemate'}</option>
                {dashboard?.members
                  .filter((member) => member.memberId !== memberId && member.status !== 'left')
                  .map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.displayName}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <Field label={`${ru ? 'Сумма' : 'Amount'} (${currency})`}>
            <Input
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          {editor === 'transfer' ? (
            <Field label={ru ? 'Дата перевода' : 'Transfer date'}>
              <Input
                type="date"
                value={date}
                max={today}
                disabled={busy}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          ) : null}
          {editor === 'transfer' && amountMinor > 0n ? (
            <div className="rounded-xl bg-primary-soft p-3 text-sm">
              <p>
                {balanceText(offset)} → {balanceText(offset - amountMinor)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ru
                  ? 'После подтверждения. Сумма сверх долга станет вашим кредитом.'
                  : 'After confirmation. Any amount beyond your debt becomes your credit.'}
              </p>
            </div>
          ) : null}
          {editor === 'request' ? (
            <p className="text-xs text-muted-foreground">
              {ru ? 'Доступно к возврату' : 'Outstanding credit'}: {money(credit)}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Sheet>
    </Card>
  )
}
