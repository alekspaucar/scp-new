'use client'

import { useState, type FormEvent } from 'react'
import { api, jsonRequest, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { moduleLabels } from '@/lib/domain'
import type { Access, Module, Permissions, User } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './settings.css'

type Role = 'jefe' | 'admin' | 'empleado' | 'operador'
type Editor = { id: number; username: string; password: string; rol: Role; permisos: Permissions | null; savedBase?: boolean; error?: string }
const modules = Object.keys(moduleLabels) as Module[]
const roles: Role[] = ['jefe', 'admin', 'empleado', 'operador']
const accessLabels: Record<Access, string> = { ninguno: 'Sin acceso', ver: 'Solo ver', editar: 'Ver y editar' }
const managerRole = (role: string) => role === 'admin' || role === 'jefe'
function defaults(role: Role): Permissions {
  return Object.fromEntries(modules.map(module => [module, managerRole(role) ? 'editar' : ['pedidos', 'produccion', 'calculadora'].includes(module) ? 'ver' : 'ninguno'])) as Permissions
}

export function Users({ active = true }: { active?: boolean }) {
  const { user, isManager, refresh } = useSession()
  const resource = useResource<User[]>(active && isManager ? 'usuarios' : null)
  const task = useTask()
  const [search, setSearch] = useState(''), [editor, setEditor] = useState<Editor | null>(null)
  const visible = (resource.data || []).filter(u => `${u.username} ${u.rol}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
  const ownAccount = Boolean(editor?.id && editor.id === user?.id)
  function open(value?: User) {
    task.clear()
    setEditor(value ? { id: value.id, username: value.username, password: '', rol: value.rol as Role, permisos: value.permisos_personalizados && !managerRole(value.rol) ? { ...value.permisos } : null } : { id: 0, username: '', password: '', rol: 'empleado', permisos: null })
  }
  function close() { if (!task.busy) setEditor(null) }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !isManager) return
    const input = editor
    await task.run(async () => {
      let current = { ...input }
      let savedThisAttempt = false
      try {
        if (!current.username.trim() || (!current.id && !current.password)) throw new Error('Ingresa el nombre de usuario y la contraseña inicial.')
        if (user && current.id === user.id && current.rol !== user.rol) throw new Error('No puedes cambiar tu propio rol.')
        const result = await api<{ usuario: User }>(current.id ? `usuarios/${current.id}` : 'usuarios', jsonRequest(current.id ? 'PUT' : 'POST', { username: current.username.trim(), password: current.password, rol: current.rol, permisos: managerRole(current.rol) ? null : current.permisos }))
        current = { ...current, id: result.usuario.id, username: result.usuario.username, password: '', savedBase: true, error: '' }
        savedThisAttempt = true
        setEditor(current)
        await resource.reload(); setEditor(null)
        return true
      } catch (reason) {
        const error = `${savedThisAttempt ? 'La cuenta y sus permisos ya están guardados; reintenta la consulta. ' : ''}${reason instanceof Error ? reason.message : 'No se pudo guardar el usuario.'}`
        setEditor({ ...current, error }); await resource.reload(); throw new Error(error)
      } finally {
        if (current.id === user?.id) await refresh()
      }
    }, 'Usuario y permisos guardados.')
  }
  async function remove(target: User) {
    if (!isManager || target.id === user?.id || !await confirmAction(`¿Eliminar la cuenta «${target.username}»? Perderá el acceso al sistema.`, { title: 'Eliminar usuario', confirmLabel: 'Eliminar', danger: true })) return
    await task.run(async () => { await api(`usuarios/${target.id}`, { method: 'DELETE' }); await resource.reload(); return true }, 'Usuario eliminado.')
  }
  if (!active) return null
  if (!isManager) return <Empty>Solo admin y jefe pueden administrar usuarios y permisos.</Empty>
  return <section className="view-stack management-view">
    <Heading title="Usuarios y permisos" actions={<Button variant="primary" disabled={task.busy} onClick={() => open()}>Nuevo usuario</Button>} />
    <Feedback task={task} /><DataState resource={resource} />
    <Panel className="table-card"><div className="table-toolbar"><label className="search-field"><input value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar usuarios" placeholder="Nombre de usuario o rol…" /></label><span className="subtle">{visible.length} cuentas</span></div>
    {!visible.length && !resource.loading && !resource.error ? <Empty>{search ? 'No hay usuarios que coincidan con la búsqueda.' : 'No hay usuarios para mostrar.'}</Empty> : <ScrollTable><table className="management-table"><thead><tr><th>Cuenta</th><th>Rol</th><th>Permisos</th>{modules.map(module => <th key={module}>{moduleLabels[module]}</th>)}<th>Acciones</th></tr></thead><tbody>{visible.map(value => <tr key={value.id}>
      <td><strong>{value.username}</strong>{value.id === user?.id && <small>Tu cuenta</small>}</td><td>{value.rol}</td><td><Status value={value.permisos_personalizados ? 'Personalizados' : 'Del rol'} /></td>{modules.map(module => <td key={module}><Status value={accessLabels[value.permisos[module]]} tone={value.permisos[module] === 'editar' ? 'green' : value.permisos[module] === 'ver' ? 'blue' : 'amber'} /></td>)}
      <td><div className="management-actions"><Button disabled={task.busy} onClick={() => open(value)}>Editar</Button><Button variant="danger" disabled={task.busy || value.id === user?.id} title={value.id === user?.id ? 'No puedes eliminar tu propia cuenta' : 'Eliminar cuenta'} onClick={() => void remove(value)}>Eliminar</Button></div></td>
    </tr>)}</tbody></table></ScrollTable>}</Panel>
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
      <div className="modal-actions"><Button onClick={close}>Cancelar</Button><Button variant="primary" type="submit">{task.busy ? 'Guardando…' : 'Guardar cambios'}</Button></div>
    </fieldset></form></Modal>}
  </section>
}
