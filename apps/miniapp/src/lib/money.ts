export function majorStringToMinor(value: string): bigint {
  const trimmed = value.trim().replace(',', '.')
  const negative = trimmed.startsWith('-')
  const normalized = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = normalized.split('.')
  const major = BigInt(whole || '0')
  const cents = BigInt((fraction.padEnd(2, '0').slice(0, 2) || '00').replace(/\D/g, '') || '0')
  const minor = major * 100n + cents

  return negative ? -minor : minor
}

export function minorToMajorString(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')

  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`
}

/**
 * Typed amounts, kept to what a money field can hold: digits, one decimal point and
 * at most two decimals. "12,5" becomes "12.5"; spaces, letters and signs are dropped.
 */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

/** Minor units of a user-typed amount; anything unparseable counts as zero. */
export function parseMoneyInput(value: string): bigint {
  try {
    return majorStringToMinor(sanitizeMoneyInput(value) || '0')
  } catch {
    return 0n
  }
}
