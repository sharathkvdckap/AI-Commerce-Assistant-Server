const STORAGE_KEY = 'ai-commerce-assistant-user-id'

/** Stable guest identity for context memory until Magento customer auth is wired. */
export function getOrCreateUserId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)?.trim()
    if (existing) return existing
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    return `guest-session-${Date.now()}`
  }
}
