'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useSession } from '@/components/session-provider'

// Shared by every order action; unmounting a detail must not release a request.
let locked = false
const listeners = new Set<() => void>()
const isBusy = () => locked
const serverSnapshot = () => false
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notify() { listeners.forEach(listener => listener()) }

async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
  if (locked) return undefined
  locked = true
  try { notify(); return await job() }
  finally { locked = false; notify() }
}

export function useOrderAction() {
  const busy = useSyncExternalStore(subscribe, isBusy, serverSnapshot)
  return { busy, isBusy, run }
}

// Confirmations and uploads can outlive the permissions/state they opened
// under. Keep the original intent tied to its live session and component.
export function useCurrentOrderGuard(allowed: boolean, key = '') {
  const { user } = useSession(), identity = `${user?.id ?? ''}:${key}`
  const current = useRef({ allowed, identity, mounted: true })
  current.current.allowed = allowed; current.current.identity = identity
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false } }, [])
  return () => current.current.mounted && current.current.allowed && current.current.identity === identity
}
