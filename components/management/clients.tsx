'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, jsonRequest, upload, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import type { Client } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './settings.css'

type Draft = { key: string; value: Client; file?: File; savedBase?: boolean; error?: string }
const fields = [
  ['ruc', 'RUC', false], ['direccion_facturacion', 'Dirección de facturación', true],
  ['direccion_entrega', 'Dirección de entrega', true], ['contacto_principal', 'Contacto principal', true],
  ['horarios_entrega', 'Horarios de entrega', true], ['plazos_entrega', 'Plazos de entrega', true],
] as const
const message = (reason: unknown) => reason instanceof Error ? reason.message : 'No se pudo completar la operación'

export function Clients({ active = true }: { active?: boolean }) {
  const { can } = useSession()
  const readable = can('configuracion') || can('pedidos') || can('produccion') || can('reportes')
  const editable = can('configuracion', 'editar')
  const resource = useResource<Client[]>(active && readable ? 'clientes' : null)
  const task = useTask(), counter = useRef(0)
  const [search, setSearch] = useState(''), [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set()), [errors, setErrors] = useState<Record<string, string>>({})
  const [editor, setEditor] = useState<Draft | null>(null), [preview, setPreview] = useState('')
  useEffect(() => {
    if (!editor?.file) { setPreview(''); return }
    const url = URL.createObjectURL(editor.file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [editor?.file])
  const draftIds = new Set(Object.values(drafts).map(d => d.value.id).filter(Boolean))
  const rows: Draft[] = [...(resource.data || []).filter(c => !draftIds.has(c.id)).map(value => ({ key: String(value.id), value })), ...Object.values(drafts)]
  const query = search.trim().toLocaleLowerCase('es')
  const visible = rows.filter(({ value }) => [value.codigo, value.nombre, ...fields.map(([key]) => value[key])].some(v => String(v || '').toLocaleLowerCase('es').includes(query)))
  const toggle = (key: string, checked: boolean) => setSelected(previous => { const next = new Set(previous); if (checked) next.add(key); else next.delete(key); return next })
  const clearDraft = (key: string) => { setDrafts(previous => { const next = { ...previous }; delete next[key]; return next }); setErrors(previous => { const next = { ...previous }; delete next[key]; return next }) }
  const patch = (value: Partial<Client>) => setEditor(previous => previous ? { ...previous, value: { ...previous.value, ...value } } : null)
  function open(row?: Draft) { task.clear(); setEditor(row ? { ...row, value: { ...row.value } } : { key: `new-${++counter.current}`, value: { id: 0, codigo: '', nombre: '' } }) }
  function close() { if (!task.busy) setEditor(null) }
  function payload(value: Client) {
    if (!value.codigo.trim() || !value.nombre.trim()) throw new Error('El código y el nombre del cliente son obligatorios.')
    return { codigo: value.codigo.trim(), nombre: value.nombre.trim(), ...Object.fromEntries(fields.map(([key]) => [key, value[key]?.trim() || ''])) }
  }
  async function chooseLogo(file?: File) {
    if (!file) return
    await task.run(async () => {
      if (!/\.png$/i.test(file.name) || file.size > 200 * 1024) throw new Error('El logo debe ser PNG y pesar como máximo 200 KB.')
      const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) throw new Error('El archivo no es una imagen PNG válida.')
      const bitmap = await createImageBitmap(file).catch(() => { throw new Error('No se pudo leer la imagen PNG.') })
      const valid = bitmap.width <= 200 && bitmap.height <= 200; bitmap.close()
      if (!valid) throw new Error('El logo debe medir como máximo 200 × 200 píxeles.')
      setEditor(previous => previous ? { ...previous, file, error: '' } : null)
      return true
    })
  }
  async function persist(input: Draft) {
    let current = { ...input, value: { ...input.value }, error: '' }
    let savedThisAttempt = false
    try {
      if (!editable) throw new Error('No tienes permiso para modificar clientes.')
      const result = await api<{ cliente: Client }>(current.value.id ? `clientes/${current.value.id}` : 'clientes', jsonRequest(current.value.id ? 'PUT' : 'POST', payload(current.value)))
      current = { ...current, value: result.cliente, savedBase: true }
      savedThisAttempt = true
      setDrafts(previous => ({ ...previous, [current.key]: current }))
      setEditor(previous => previous?.key === current.key ? current : previous)
      if (current.file) await upload(`clientes/${current.value.id}/logo`, current.file)
      return current
    } catch (reason) {
      current = { ...current, error: `${savedThisAttempt ? 'Datos guardados; queda pendiente completar el logo. ' : ''}${message(reason)}` }
      setDrafts(previous => ({ ...previous, [current.key]: current }))
      setEditor(previous => previous?.key === current.key ? current : previous)
      throw new Error(current.error)
    }
  }
  async function saveOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !editable) return
    const current = editor
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft') {
      try { payload(current.value) } catch (reason) { setEditor({ ...current, error: message(reason) }); return }
      setDrafts(previous => ({ ...previous, [current.key]: { ...current, error: '' } })); toggle(current.key, true); setEditor(null); return
    }
    await task.run(async () => { await persist(current); await resource.reload(); clearDraft(current.key); toggle(current.key, false); setEditor(null); return true }, 'Cliente guardado.')
  }
  async function saveBatch() {
    const pending = Object.values(drafts).filter(d => selected.has(d.key))
    if (!editable || !pending.length) return
    await task.run(async () => {
      const successes: string[] = []; let failures = 0
      for (const draft of pending) { try { await persist(draft); successes.push(draft.key) } catch { failures++ } }
      await resource.reload(); successes.forEach(key => { clearDraft(key); toggle(key, false) })
      if (failures) throw new Error(`${successes.length} guardados; ${failures} pendientes. Los borradores con error se conservan para reintentar.`)
      return true
    }, 'Borradores seleccionados guardados.')
  }
  async function remove(targets: Draft[]) {
    if (!editable || !targets.length || !await confirmAction(`¿Eliminar definitivamente ${targets.length} cliente(s) guardados?`, { title: 'Eliminar clientes', confirmLabel: 'Eliminar', danger: true })) return
    await task.run(async () => {
      let failures = 0, successes = 0
      for (const row of targets) {
        try { if (row.value.id) await api(`clientes/${row.value.id}`, { method: 'DELETE' }); clearDraft(row.key); toggle(row.key, false); successes++ }
        catch (reason) { failures++; setErrors(previous => ({ ...previous, [row.key]: message(reason) })) }
      }
      await resource.reload()
      if (failures) throw new Error(`${successes} eliminados; ${failures} no se pudieron eliminar. Revisa las filas y reintenta.`)
      return true
    }, 'Clientes eliminados.')
  }
  if (!active) return null
  if (!readable) return <Empty>No tienes acceso a clientes.</Empty>
  return <section className="view-stack management-view">
    <Heading title="Clientes" actions={editable && <Button variant="primary" disabled={task.busy} onClick={() => open()}>Nuevo cliente</Button>} />
    <Feedback task={task} /><DataState resource={resource} />
    <Panel className="table-card"><div className="table-toolbar"><label className="search-field"><input aria-label="Buscar clientes" value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, nombre, RUC, contacto…" /></label><span className="subtle">{visible.length} clientes · {Object.keys(drafts).length} borradores · {selected.size} seleccionados</span>
      {editable && <div className="management-actions"><Button disabled={task.busy || !Object.values(drafts).some(d => selected.has(d.key))} onClick={() => void saveBatch()}>Guardar borradores</Button><Button variant="danger" disabled={task.busy || !rows.some(r => selected.has(r.key))} onClick={() => void remove(rows.filter(r => selected.has(r.key)))}>Eliminar selección</Button></div>}
    </div>
    {Object.keys(drafts).length > 0 && <p className="subtle management-message">Cambios sin guardar: selecciona los borradores y pulsa «Guardar borradores». Recargar descarta los pendientes.</p>}
    {!visible.length && !resource.loading && !resource.error ? <Empty>{query ? 'No hay clientes que coincidan con la búsqueda.' : 'No hay clientes guardados. Crea el primero.'}</Empty> : <ScrollTable><table className="management-table"><thead><tr>{editable && <th><input type="checkbox" aria-label="Seleccionar clientes visibles" disabled={task.busy || !visible.length} checked={visible.length > 0 && visible.every(r => selected.has(r.key))} onChange={e => { const checked = e.target.checked; setSelected(previous => { const next = new Set(previous); visible.forEach(r => checked ? next.add(r.key) : next.delete(r.key)); return next }) }} /></th>}<th>Código / nombre</th><th>Logo</th><th>RUC</th><th>Facturación</th><th>Entrega</th><th>Contacto</th><th>Horarios</th><th>Plazos</th>{editable && <th>Acciones</th>}</tr></thead><tbody>{visible.map(row => { const c = row.value; return <tr key={row.key} className={drafts[row.key] ? 'management-draft' : ''}>
      {editable && <td><input type="checkbox" aria-label={`Seleccionar ${c.nombre || c.codigo}`} disabled={task.busy} checked={selected.has(row.key)} onChange={e => toggle(row.key, e.target.checked)} /></td>}
      <td><strong>{c.codigo}</strong><small>{c.nombre}</small>{drafts[row.key] && <Status value={row.savedBase && row.file ? 'Logo pendiente' : 'Borrador'} tone="amber" />}{row.error && <p className="management-error" role="alert">{row.error}</p>}{errors[row.key] && <p className="management-error" role="alert">{errors[row.key]}</p>}</td><td>{row.file ? `Por subir: ${row.file.name}` : c.logo_url ? <a href={c.logo_url} target="_blank" rel="noreferrer"><img className="management-logo" src={c.logo_url} alt={`Logo de ${c.nombre}`} /></a> : 'Sin logo'}</td>{fields.map(([key]) => <td key={key}>{c[key] || '—'}</td>)}
      {editable && <td><div className="management-actions"><Button disabled={task.busy} onClick={() => open(row)}>Editar</Button><Button variant="danger" disabled={task.busy} onClick={() => void remove([row])}>Eliminar</Button>{drafts[row.key] && <Button disabled={task.busy} onClick={async () => { if (await confirmAction(row.savedBase ? '¿Descartar el logo pendiente? Los datos base ya están guardados.' : '¿Descartar este borrador?', { title: 'Descartar borrador', confirmLabel: 'Descartar', danger: true })) { clearDraft(row.key); toggle(row.key, false) } }}>Descartar borrador</Button>}</div></td>}
    </tr> })}</tbody></table></ScrollTable>}
    </Panel>
    {editor && editable && <Modal title={editor.value.id ? 'Editar cliente' : 'Nuevo cliente'} onClose={close} wide><form className="management-form" onSubmit={saveOne}><fieldset disabled={task.busy}>
      <details className="inline-help"><summary>Ayuda</summary><p className="subtle">El código guardado no se puede cambiar. Guarda para aplicar los cambios o déjalos en borrador para guardarlos en grupo.</p></details>
      {editor.savedBase && <p className="subtle">El cliente #{editor.value.id} ya está guardado. Puedes reintentar el logo sin crear otro cliente.</p>}
      <div className="form-grid"><label>Código<input required readOnly={Boolean(editor.value.id)} maxLength={50} value={editor.value.codigo} onChange={e => patch({ codigo: e.target.value })} /></label><label>Nombre<input required maxLength={150} value={editor.value.nombre} onChange={e => patch({ nombre: e.target.value })} /></label>
      {fields.map(([key, label, multiline]) => <label key={key} className={multiline ? 'wide' : ''}>{label}{multiline ? <textarea maxLength={key.startsWith('direccion') ? 250 : 150} value={editor.value[key] || ''} onChange={e => patch({ [key]: e.target.value })} /> : <input maxLength={20} value={editor.value[key] || ''} onChange={e => patch({ [key]: e.target.value })} />}</label>)}
      <label className="wide">Logo PNG (máximo 200 KB y 200 × 200 píxeles)<input type="file" accept=".png,image/png" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void chooseLogo(file) }} /></label></div>
      <div className="management-preview">{(preview || editor.value.logo_url) && <img src={preview || editor.value.logo_url || ''} alt={preview ? 'Vista previa del logo pendiente' : 'Logo actual'} />}{editor.file && <span>{editor.file.name} · {(editor.file.size / 1024).toFixed(1)} KB <Button onClick={() => setEditor(previous => previous ? { ...previous, file: undefined } : null)}>Quitar archivo elegido</Button></span>}{editor.value.logo_url && <a href={editor.value.logo_url} target="_blank" rel="noreferrer">Abrir logo guardado</a>}</div>
      <p className="subtle">Elegir otro PNG reemplaza el logo al guardar.</p>
      {editor.error && <p className="management-error" role="alert">{editor.error}</p>}<Feedback task={task} />
      <div className="modal-actions"><Button onClick={close}>Cancelar</Button><Button type="submit" value="draft">Dejar en borrador</Button><Button type="submit" value="save" variant="primary">{task.busy ? 'Guardando…' : editor.error ? 'Reintentar' : 'Guardar cliente'}</Button></div>
    </fieldset></form></Modal>}
  </section>
}
