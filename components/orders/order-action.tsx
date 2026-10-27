'use client'

import { useSyncExternalStore } from 'react'

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
