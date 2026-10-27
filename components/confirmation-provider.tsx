'use client'

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CircleHelp } from 'lucide-react'
import { confirmationStore, type ConfirmationRequest } from '@/lib/confirm'
import { useSession } from '@/components/session-provider'

function outsideDialog(dialog: HTMLDialogElement, x: number, y: number) {
  const bounds = dialog.getBoundingClientRect()
  return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
}

function ConfirmationDialog({ request }: { request: ConfirmationRequest }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const startedOnBackdrop = useRef(false)
  const titleId = useId(), messageId = useId()
  const { title = 'Confirmar acción', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = request.options

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    try {
      // Native dialogs can stack over an already open editor dialog.
      dialog.showModal()
      cancelRef.current?.focus({ preventScroll: true })
    } catch {
      confirmationStore.resolve(request.id, false)
    }
    return () => {
      if (dialog.open) dialog.close()
      if (previousFocus?.isConnected && !previousFocus.matches(':disabled') && !previousFocus.closest('[inert]')) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [request.id])

  return <dialog ref={dialogRef} className="dialog-shell confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); confirmationStore.resolve(request.id, false) }}
    onClose={event => { if (!event.currentTarget.open) confirmationStore.resolve(request.id, false) }}
    onPointerDown={event => { startedOnBackdrop.current = event.target === event.currentTarget && outsideDialog(event.currentTarget, event.clientX, event.clientY) }}
    onPointerCancel={() => { startedOnBackdrop.current = false }}
    onClick={event => {
      if (startedOnBackdrop.current && event.target === event.currentTarget && outsideDialog(event.currentTarget, event.clientX, event.clientY)) {
        confirmationStore.resolve(request.id, false)
      }
      startedOnBackdrop.current = false
    }}>
    <div className={`confirmation-icon${danger ? ' danger' : ''}`} aria-hidden="true">{danger ? <AlertTriangle size={22} /> : <CircleHelp size={22} />}</div>
    <h2 id={titleId}>{title}</h2>
    <p id={messageId}>{request.message}</p>
    <div className="confirmation-actions">
      <button ref={cancelRef} type="button" className="soft-button" autoFocus onClick={() => confirmationStore.resolve(request.id, false)}>{cancelLabel}</button>
      <button type="button" className={danger ? 'danger-button' : 'primary-button'} onClick={() => confirmationStore.resolve(request.id, true)}>{confirmLabel}</button>
    </div>
  </dialog>
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const request = useSyncExternalStore(confirmationStore.subscribe, confirmationStore.getSnapshot, confirmationStore.getServerSnapshot)
  // Cancel the previous account's active and queued requests before the new identity is painted.
  useLayoutEffect(() => confirmationStore.mount(), [user?.id])
  // Portaling directly to body inherits its theme variables and local typeface.
  return <>{children}{request && createPortal(<ConfirmationDialog key={request.id} request={request} />, document.body)}</>
}
