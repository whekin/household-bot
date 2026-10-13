/** Exchange rates travel as integer micros ("2760000" = 2.76) to keep money math exact. */

export function fxRateFromMicros(value: string | null): string | null {
  if (!value) return null
  const normalized = value.padStart(7, '0')
  const whole = normalized.slice(0, -6) || '0'
  const fraction = normalized.slice(-6).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

export function fxRateToMicros(value: string): string | null {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed.length === 0) return null
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed)
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(6, '0')
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
}
