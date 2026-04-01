export function formatUserFacingMoney(amount: string, currency: string): string {
  if (currency === 'USD') {
    return `$${amount}`
  }

  if (currency === 'GEL') {
    return `${amount} ₾`
  }

  return `${amount} ${currency}`
}
