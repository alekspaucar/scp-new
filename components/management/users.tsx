'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, jsonRequest, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { moduleLabels } from '@/lib/domain'
import type { Access, Module, Permissions, User } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './settings.css'

type Role = 'jefe' | 'admin' | 'empleado' | 'operador'
type Editor = { key: string; id: number; username: string; password: string; rol: Role; permisos: Permissions | null; savedBase?: boolean; error?: string }
const modules = Object.keys(moduleLabels) as Module[]
const roles: Role[] = ['jefe', 'admin', 'empleado', 'operador']
const accessLabels: Record<Access, string> = { ninguno: 'Sin acceso', ver: 'Solo ver', editar: 'Ver y editar' }
const managerRole = (role: string) => role === 'admin' || role === 'jefe'
function defaults(role: Role): Permissions {
  return Object.fromEntries(modules.map(module => [module, managerRole(role) ? 'editar' : ['pedidos', 'produccion', 'calculadora'].includes(module) ? 'ver' : 'ninguno'])) as Permissions
}

export function Users({ active = true }: { active?: boolean }) {
  const { user, isManager, refresh } = useSession()
  const identity = user?.id
  const live = useRef({ identity, allowed: isManager, mounted: true })
  live.current.identity = identity; live.current.allowed = isManager
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false } }, [])
  // Each handler keeps its initiating identity, even if another manager signs in.
  const canWrite = () => live.current.mounted && live.current.allowed && live.current.identity === identity
  const counter = useRef(0)
  const resource = useResource<User[]>(active && isManager ? 'usuarios' : null)
  const task = useTask()
  const [search, setSearch] = useState(''), [editor, setEditor] = useState<Editor | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Editor>>({}), [selected, setSelected] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const draftIds = new Set(Object.values(drafts).map(draft => draft.id).filter(Boolean))
  const rows: Editor[] = [...(resource.data || []).filter(value => !draftIds.has(value.id)).map(value => fromUser(value)), ...Object.values(drafts)]
  const visible = rows.filter(value => `${value.username} ${value.rol}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
  const ownAccount = Boolean(editor?.id && editor.id === user?.id)
  function fromUser(value: User): Editor { return { key: String(value.id), id: value.id, username: value.username, password: '', rol: value.rol as Role, permisos: value.permisos_personalizados && !managerRole(value.rol) ? { ...value.permisos } : null } }
  const toggle = (key: string, checked: boolean) => setSelected(previous => { const next = new Set(previous); if (checked) next.add(key); else next.delete(key); return next })
  function clearDraft(key: string) { setDrafts(previous => { const next = { ...previous }; delete next[key]; return next }); setErrors(previous => { const next = { ...previous }; delete next[key]; return next }) }
  function open(value?: Editor) {
    task.clear()
    setEditor(value ? { ...value, permisos: value.permisos ? { ...value.permisos } : null } : { key: `new-${++counter.current}`, id: 0, username: '', password: '', rol: 'empleado', permisos: null })
  }
  function close() { if (!task.busy) setEditor(null) }
  function payload(current: Editor) {
    if (!current.username.trim() || (!current.id && !current.password.trim())) throw new Error('Ingresa el nombre de usuario y la contraseña inicial.')
    if (user && current.id === user.id && current.rol !== user.rol) throw new Error('No puedes cambiar tu propio rol.')
    return { username: current.username.trim(), password: current.password, rol: current.rol, permisos: managerRole(current.rol) ? null : current.permisos }
  }
  async function persist(input: Editor) {
    let current = { ...input, error: '' }
    try {
      if (!canWrite()) return
      const result = await api<{ usuario: User }>(current.id ? `usuarios/${current.id}` : 'usuarios', jsonRequest(current.id ? 'PUT' : 'POST', payload(current)))
      if (!canWrite()) return
      current = { ...current, ...fromUser(result.usuario), key: current.key, savedBase: true }
      setEditor(previous => previous?.key === current.key ? current : previous)
      return current
    } catch (reason) {
      if (!canWrite()) return
      current = { ...current, error: reason instanceof Error ? reason.message : 'No se pudo guardar el usuario.' }
      setDrafts(previous => ({ ...previous, [current.key]: current }))
      setEditor(previous => previous?.key === current.key ? current : previous)
      throw new Error(current.error)
    } finally {
      if (canWrite() && current.id === identity) await refresh()
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !canWrite() || task.busy) return
    const input = editor
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft') {
      try { payload(input) } catch (reason) { setEditor({ ...input, error: reason instanceof Error ? reason.message : 'Revisa la cuenta.' }); return }
      setDrafts(previous => ({ ...previous, [input.key]: { ...input, error: '' } })); toggle(input.key, true); setEditor(null); return
    }
    await task.run(async () => {
      if (!await persist(input) || !canWrite()) return
      clearDraft(input.key); toggle(input.key, false); await resource.reload()
      if (!canWrite()) return
      setEditor(null); return true
    }, 'Usuario y permisos guardados.')
  }
  async function saveBatch() {
    const pending = Object.values(drafts).filter(draft => selected.has(draft.key))
    if (!canWrite() || task.busy || !pending.length) return
    await task.run(async () => {
      let successes = 0, failures = 0
      for (const draft of pending) {
        try {
          if (!await persist(draft) || !canWrite()) return
          clearDraft(draft.key); toggle(draft.key, false); successes++
        } catch { if (!canWrite()) return; failures++ }
      }
      await resource.reload()
      if (!canWrite()) return
      if (failures) throw new Error(`${successes} guardados; ${failures} pendientes. Los borradores con error se conservan para reintentar.`)
      return true
    }, 'Usuarios y permisos guardados.')
  }
  async function remove(targets: Editor[]) {
    const removable = targets.filter(target => target.id !== user?.id)
    if (!canWrite() || task.busy || !removable.length || !await confirmAction(`¿Eliminar ${removable.length} cuenta(s)? Las cuentas guardadas perderán el acceso al sistema.`, { title: 'Eliminar usuarios', confirmLabel: 'Eliminar', danger: true }) || !canWrite()) return
    await task.run(async () => {
      let successes = 0, failures = 0
      for (const target of removable) {
        try {
          if (!canWrite()) return
          if (target.id) await api(`usuarios/${target.id}`, { method: 'DELETE' })
          if (!canWrite()) return
          clearDraft(target.key); toggle(target.key, false); successes++
        } catch (reason) {
          if (!canWrite()) return
          failures++; setErrors(previous => ({ ...previous, [target.key]: reason instanceof Error ? reason.message : 'No se pudo eliminar.' }))
        }
      }
      await resource.reload()
      if (!canWrite()) return
      if (failures) throw new Error(`${successes} eliminados; ${failures} pendientes. Revisa las filas con error.`)
      return true
    }, 'Usuarios eliminados.')
  }
  if (!active) return null
  if (!isManager) return <Empty>Solo admin y jefe pueden administrar usuarios y permisos.</Empty>
  return <section className="view-stack management-view">
    <Heading title="Usuarios y permisos" actions={<Button variant="primary" disabled={task.busy} onClick={() => open()}>Nuevo usuario</Button>} />
    <Feedback task={task} /><DataState resource={resource} />
    <Panel className="table-card"><div className="table-toolbar"><label className="search-field"><input value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar usuarios" placeholder="Nombre de usuario o rol…" /></label><span className="subtle">{visible.length} cuentas · {Object.keys(drafts).length} borradores · {selected.size} seleccionadas</span><div className="management-actions"><Button disabled={task.busy || !Object.values(drafts).some(draft => selected.has(draft.key))} onClick={() => saveBatch()}>Guardar borradores</Button><Button variant="danger" disabled={task.busy || !rows.some(row => selected.has(row.key) && row.id !== user?.id)} onClick={() => remove(rows.filter(row => selected.has(row.key)))}>Eliminar selección</Button></div></div>
    {Object.keys(drafts).length > 0 && <p className="subtle management-message">Los borradores están en esta pantalla. Recargar o salir descarta los cambios pendientes.</p>}
    {!visible.length && !resource.loading && !resource.error ? <Empty>{search ? 'No hay usuarios que coincidan con la búsqueda.' : 'No hay usuarios para mostrar.'}</Empty> : <ScrollTable><table className="management-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar usuarios visibles" disabled={task.busy || !visible.some(value => value.id !== user?.id)} checked={visible.some(value => value.id !== user?.id) && visible.filter(value => value.id !== user?.id).every(value => selected.has(value.key))} onChange={event => { const checked = event.target.checked; setSelected(previous => { const next = new Set(previous); visible.filter(value => value.id !== user?.id).forEach(value => checked ? next.add(value.key) : next.delete(value.key)); return next }) }} /></th><th>Cuenta</th><th>Rol</th><th>Permisos</th>{modules.map(module => <th key={module}>{moduleLabels[module]}</th>)}<th>Acciones</th></tr></thead><tbody>{visible.map(value => { const permissions = value.permisos || defaults(value.rol); return <tr key={value.key} className={drafts[value.key] ? 'management-draft' : ''}>
      <td><input type="checkbox" aria-label={`Seleccionar ${value.username}`} checked={selected.has(value.key)} disabled={task.busy || value.id === user?.id} onChange={event => toggle(value.key, event.target.checked)} /></td>
      <td><strong>{value.username}</strong>{value.id === user?.id && <small>Tu cuenta</small>}{drafts[value.key] && <Status value="Borrador" tone="amber" />}{(value.error || errors[value.key]) && <p className="management-error" role="alert">{value.error || errors[value.key]}</p>}</td><td>{value.rol}</td><td><Status value={value.permisos ? 'Personalizados' : 'Del rol'} /></td>{modules.map(module => <td key={module}><Status value={accessLabels[permissions[module]]} tone={permissions[module] === 'editar' ? 'green' : permissions[module] === 'ver' ? 'blue' : 'amber'} /></td>)}
      <td><div className="management-actions"><Button disabled={task.busy} onClick={() => open(value)}>Editar</Button><Button variant="danger" disabled={task.busy || value.id === user?.id} title={value.id === user?.id ? 'No puedes eliminar tu propia cuenta' : 'Eliminar cuenta'} onClick={() => remove([value])}>Eliminar</Button>{drafts[value.key] && <Button disabled={task.busy} onClick={async () => { if (await confirmAction('¿Descartar los cambios pendientes de esta cuenta?', { title: 'Descartar borrador', confirmLabel: 'Descartar', danger: true }) && canWrite()) { clearDraft(value.key); toggle(value.key, false) } }}>Descartar borrador</Button>}</div></td>
    </tr> })}</tbody></table></ScrollTable>}</Panel>
    {editor && <Modal title={editor.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={close} wide><form className="management-form" onSubmit={save}><fieldset disabled={task.busy}>
      {editor.savedBase && <p className="subtle">Cuenta #{editor.id} guardada. Reintentar actualizará esta misma cuenta.</p>}
      <div className="form-grid"><label>Nombre de usuario<input required maxLength={80} autoComplete="off" value={editor.username} onChange={e => setEditor({ ...editor, username: e.target.value })} /></label><label>{editor.id ? 'Nueva contraseña (vacía conserva la actual)' : 'Contraseña inicial'}<input type="password" required={!editor.id} autoComplete="new-password" value={editor.password} onChange={e => setEditor({ ...editor, password: e.target.value })} /></label>
      <label>Rol<select value={editor.rol} disabled={ownAccount} onChange={e => setEditor({ ...editor, rol: e.target.value as Role, permisos: null })}>{roles.map(role => <option value={role} key={role}>{role}</option>)}</select></label></div>
      {ownAccount && <p className="subtle">No puedes cambiar tu rol ni eliminar tu cuenta. Guardar actualiza tu sesión.</p>}
      <label className="management-check"><input type="checkbox" checked={editor.permisos === null} disabled={managerRole(editor.rol)} onChange={e => setEditor({ ...editor, permisos: e.target.checked ? null : defaults(editor.rol) })} />Usar permisos predeterminados del rol</label>
      <p className="subtle">{managerRole(editor.rol) ? 'Admin y jefe siempre tienen acceso completo.' : 'Por defecto: consulta de Pedidos, Producción y Calculadora. Cambiar el rol restablece los permisos.'}</p>
      <div className="management-permissions">{modules.map(module => <label key={module}>{moduleLabels[module]}<select aria-label={`Permiso de ${moduleLabels[module]}`} disabled={editor.permisos === null || managerRole(editor.rol)} value={(editor.permisos || defaults(editor.rol))[module]} onChange={e => setEditor({ ...editor, permisos: { ...(editor.permisos || defaults(editor.rol)), [module]: e.target.value as Access } })}>{(['ninguno', 'ver', 'editar'] as Access[]).map(access => <option value={access} key={access}>{accessLabels[access]}</option>)}</select></label>)}</div>
      <div className="management-actions management-message"><Button disabled={managerRole(editor.rol)} onClick={() => setEditor({ ...editor, permisos: null })}>Restablecer permisos del rol</Button></div>
      {editor.error && <p className="management-error" role="alert">{editor.error}</p>}<Feedback task={task} />
      <div className="modal-actions"><Button onClick={close}>Cancelar</Button><Button type="submit" value="draft">Dejar en borrador</Button><Button variant="primary" type="submit" value="save">{task.busy ? 'Guardando…' : 'Guardar cambios'}</Button></div>
    </fieldset></form></Modal>}
  </section>
}
