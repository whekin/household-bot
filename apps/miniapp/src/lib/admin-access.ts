export type EffectiveAdminPreview = 'admin' | 'resident'

export interface EffectiveAdminMember {
  isAdmin: boolean
  status: 'active' | 'away' | 'left'
}

export function hasEffectiveAdminAccess(
  member: EffectiveAdminMember | null | undefined,
  preview: EffectiveAdminPreview | null
): boolean {
  if (!member?.isAdmin || member.status !== 'active') return false
  if (!preview) return true
  return preview === 'admin'
}
