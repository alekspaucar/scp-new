'use client'

export interface ConfirmationOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmationRequest {
  readonly id: number
  readonly message: string
  readonly options: ConfirmationOptions
}

const queue: { request: ConfirmationRequest; resolve: (confirmed: boolean) => void }[] = []
const listeners = new Set<() => void>()
let nextId = 0
let accepting = true

function notify() { listeners.forEach(listener => listener()) }

export async function confirmAction(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
  if (typeof document === 'undefined' || !accepting) return false
  return new Promise<boolean>(resolve => {
    // Keep early requests even before the provider's subscription is installed.
    queue.push({ request: { id: ++nextId, message, options: { ...options } }, resolve })
    notify()
  })
}

/** Shared with the root provider; callers only need confirmAction. */
export const confirmationStore = {
  getSnapshot: (): ConfirmationRequest | null => queue[0]?.request ?? null,
  getServerSnapshot: (): ConfirmationRequest | null => null,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  mount() {
    accepting = true
    return () => {
      accepting = false
      const pending = queue.splice(0)
      pending.forEach(({ resolve }) => resolve(false))
      notify()
    }
  },
  resolve(id: number, confirmed: boolean) {
    // A delayed close event from an old dialog must not dismiss the next one.
    if (queue[0]?.request.id !== id) return
    const pending = queue.shift()!
    pending.resolve(confirmed)
    notify()
  },
}
