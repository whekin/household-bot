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

export function sumMajorStrings(left: string, right: string): string {
  return minorToMajorString(majorStringToMinor(left) + majorStringToMinor(right))
}
