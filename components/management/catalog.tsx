'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, jsonRequest, upload, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { fmt } from '@/lib/domain'
import type { Client, Material, Product } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './settings.css'

type Draft = { key: string; value: Product; file?: File; removeImage?: boolean; savedBase?: boolean; error?: string }
const numbers = [
  ['cant_etiquetas_plancha', 'Etiquetas por plancha', true],
  ['cant_planchas', 'Cantidad de planchas', true],
  ['cant_rollos', 'Cantidad de rollos', true],
  ['cant_etiquetas_rollo', 'Etiquetas por rollo', true],
  ['largo_plancha_impresa', 'Largo de plancha impresa (cm)', false],
  ['largo_rollo', 'Largo de rollo (m)', false],
  ['ancho_rollo', 'Ancho de rollo (m)', false],
  ['tiempo_base_minutos', 'Tiempo base por unidad/plancha (min)', false],
] as const
const blank = (): Product => ({ id: 0, codigo: '-', cliente: '', descripcion: '', cant_etiquetas_plancha: 0, cant_planchas: 0, cant_rollos: 0, cant_etiquetas_rollo: 0, largo_plancha_impresa: 0, largo_rollo: 0, ancho_rollo: 0, material_id: null, tipo_codigo: 'normal', tiempo_base_minutos: 1, maquina_requerida: null })
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación'

export function Catalog({ active = true }: { active?: boolean }) {
  const { can } = useSession()
  const readable = can('configuracion') || can('produccion') || can('reportes') || can('calculadora') || can('pedidos', 'editar')
  const editable = can('configuracion', 'editar')
  const writeAllowed = useRef(editable); writeAllowed.current = editable
  const resource = useResource<Product[]>(active && readable ? 'catalogo' : null)
  const materials = useResource<Material[]>(active && editable ? 'materiales' : null, 0)
  const clients = useResource<Client[]>(active && editable ? 'clientes' : null)
  const task = useTask()
  const counter = useRef(0)
  const [search, setSearch] = useState(''), [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set()), [errors, setErrors] = useState<Record<string, string>>({})
  const [editor, setEditor] = useState<Draft | null>(null), [preview, setPreview] = useState('')
  useEffect(() => {
    if (!editor?.file) { setPreview(''); return }
    const url = URL.createObjectURL(editor.file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [editor?.file])

  const draftIds = new Set(Object.values(drafts).map(d => d.value.id).filter(Boolean))
  const rows: Draft[] = [...(resource.data || []).filter(p => !draftIds.has(p.id)).map(value => ({ key: String(value.id), value })), ...Object.values(drafts)]
  const query = search.trim().toLocaleLowerCase('es')
  const visible = rows.filter(({ value }) => [value.codigo, value.cliente, value.descripcion, value.material_sku, value.tipo_codigo, value.maquina_requerida].some(v => String(v || '').toLocaleLowerCase('es').includes(query)))
  const toggle = (key: string, checked: boolean) => setSelected(previous => { const next = new Set(previous); if (checked) next.add(key); else next.delete(key); return next })
  const clearDraft = (key: string) => { setDrafts(previous => { const next = { ...previous }; delete next[key]; return next }); setErrors(previous => { const next = { ...previous }; delete next[key]; return next }) }
  const patch = (value: Partial<Product>) => setEditor(previous => previous ? { ...previous, value: { ...previous.value, ...value } } : null)
  function open(row?: Draft) { task.clear(); setEditor(row ? { ...row, value: { ...row.value } } : { key: `new-${++counter.current}`, value: blank() }) }
  function close() { if (!task.busy) setEditor(null) }
  function payload(value: Product) {
    if (!value.descripcion.trim()) throw new Error('La descripción es obligatoria.')
    for (const [field, label, integer] of numbers) {
      if (!Number.isFinite(value[field]) || value[field] < 0 || (integer && !Number.isInteger(value[field])) || (field === 'tiempo_base_minutos' && value[field] <= 0)) throw new Error(`Revisa ${label.toLowerCase()}.`)
    }
    return { codigo: value.codigo.trim() || '-', cliente: (value.cliente || '').trim(), descripcion: value.descripcion.trim(), ...Object.fromEntries(numbers.map(([field]) => [field, value[field]])), material_id: value.material_id, tipo_codigo: value.tipo_codigo, maquina_requerida: value.maquina_requerida || null }
  }
  async function persist(input: Draft) {
    let current = { ...input, value: { ...input.value }, error: '' }
    let savedThisAttempt = false
    try {
      if (!writeAllowed.current) throw new Error('No tienes permiso para modificar el catálogo.')
      const result = await api<{ producto: Product }>(current.value.id ? `catalogo/${current.value.id}` : 'catalogo', jsonRequest(current.value.id ? 'PUT' : 'POST', payload(current.value)))
      current = { ...current, value: result.producto, savedBase: true }
      savedThisAttempt = true
      setDrafts(previous => ({ ...previous, [current.key]: current }))
      setEditor(previous => previous?.key === current.key ? current : previous)
      if ((current.file || current.removeImage) && !writeAllowed.current) throw new Error('Ya no tienes permiso para modificar la referencia.')
      if (current.file) await upload(`catalogo/${current.value.id}/imagen`, current.file)
      else if (current.removeImage) await api(`catalogo/${current.value.id}/imagen`, { method: 'DELETE' })
      return current
    } catch (reason) {
      current = { ...current, error: `${savedThisAttempt ? 'Datos guardados; queda pendiente completar la referencia. ' : ''}${message(reason)}` }
      setDrafts(previous => ({ ...previous, [current.key]: current }))
      setEditor(previous => previous?.key === current.key ? current : previous)
      throw new Error(current.error)
    }
  }
  async function saveOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !writeAllowed.current || task.busy) return
    const current = editor
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')
    if (intent === 'draft') {
      try { payload(current.value) } catch (reason) { setEditor({ ...current, error: message(reason) }); return }
      setDrafts(previous => ({ ...previous, [current.key]: { ...current, error: '' } })); toggle(current.key, true); setEditor(null); return
    }
    if (current.removeImage && !await confirmAction('¿Eliminar la referencia guardada de este producto al guardar los cambios?', { title: 'Eliminar referencia', confirmLabel: 'Guardar y eliminar', danger: true })) return
    if (!writeAllowed.current) return
    await task.run(async () => { await persist(current); await resource.reload(); clearDraft(current.key); toggle(current.key, false); setEditor(null); return true }, 'Producto guardado.')
  }
  async function saveBatch() {
    const pending = Object.values(drafts).filter(d => selected.has(d.key))
    if (!pending.length || !writeAllowed.current || task.busy) return
    const removals = pending.filter(d => d.removeImage).length
    if (removals && !await confirmAction(`¿Eliminar ${removals} referencia(s) adjunta(s) al guardar este lote?`, { title: 'Eliminar referencias', confirmLabel: 'Guardar y eliminar', danger: true })) return
    await task.run(async () => {
      const successes: string[] = []; let failures = 0
      for (const draft of pending) { try { await persist(draft); successes.push(draft.key) } catch { failures++ } }
      await resource.reload(); successes.forEach(key => { clearDraft(key); toggle(key, false) })
      if (failures) throw new Error(`${successes.length} guardados; ${failures} pendientes. Los borradores con error se conservan para reintentar.`)
      return true
    }, 'Borradores seleccionados guardados.')
  }
  async function remove(targets: Draft[]) {
    if (!writeAllowed.current || task.busy || !targets.length || !await confirmAction(`¿Eliminar definitivamente ${targets.length} producto(s)?`, { title: 'Eliminar productos', confirmLabel: 'Eliminar', danger: true }) || !writeAllowed.current) return
    await task.run(async () => {
      let failures = 0, successes = 0
      for (const row of targets) {
        try { if (!writeAllowed.current) throw new Error('Ya no tienes permiso para eliminar productos.'); if (row.value.id) await api(`catalogo/${row.value.id}`, { method: 'DELETE' }); clearDraft(row.key); toggle(row.key, false); successes++ }
        catch (reason) { failures++; setErrors(previous => ({ ...previous, [row.key]: message(reason) })) }
      }
      await resource.reload()
      if (failures) throw new Error(`${successes} eliminados; ${failures} no se pudieron eliminar. Revisa las filas y reintenta.`)
      return true
    }, 'Productos eliminados.')
  }
  if (!active) return null
  if (!readable) return <Empty>No tienes acceso al catálogo.</Empty>
  return <section className="view-stack management-view">
    <Heading title="Catálogo de productos" actions={editable && <Button variant="primary" disabled={task.busy} onClick={() => open()}>Nuevo producto</Button>} />
    <Feedback task={task} /><DataState resource={resource} />
    <Panel className="table-card">
      <div className="table-toolbar"><label className="search-field"><input aria-label="Buscar en catálogo" value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, cliente, material…" /></label><span className="subtle">{visible.length} productos · {Object.keys(drafts).length} borradores · {selected.size} seleccionados</span>
        {editable && <div className="management-actions"><Button disabled={task.busy || !Object.values(drafts).some(d => selected.has(d.key))} onClick={() => void saveBatch()}>Guardar borradores</Button><Button variant="danger" disabled={task.busy || !rows.some(r => selected.has(r.key))} onClick={() => void remove(rows.filter(r => selected.has(r.key)))}>Eliminar selección</Button></div>}
      </div>
      {Object.keys(drafts).length > 0 && <p className="subtle management-message">Cambios sin guardar: selecciona los borradores y pulsa «Guardar borradores». Recargar descarta los pendientes.</p>}
      {!visible.length && !resource.loading && !resource.error ? <Empty>{query ? 'No hay productos que coincidan con la búsqueda.' : 'No hay productos guardados. Crea el primero.'}</Empty> : <ScrollTable><table className="management-table"><thead><tr>{editable && <th><input type="checkbox" aria-label="Seleccionar productos visibles" disabled={task.busy || !visible.length} checked={visible.length > 0 && visible.every(r => selected.has(r.key))} onChange={e => { const checked = e.target.checked; setSelected(previous => { const next = new Set(previous); visible.forEach(r => checked ? next.add(r.key) : next.delete(r.key)); return next }) }} /></th>}<th>Código / cliente</th><th>Descripción / tipo</th><th>Rendimientos</th><th>Dimensiones</th><th>Material</th><th>Planificación</th><th>Referencia</th>{editable && <th>Acciones</th>}</tr></thead><tbody>{visible.map(row => { const p = row.value; return <tr key={row.key} className={drafts[row.key] ? 'management-draft' : ''}>
        {editable && <td><input type="checkbox" aria-label={`Seleccionar ${p.codigo}, ${p.descripcion}`} disabled={task.busy} checked={selected.has(row.key)} onChange={e => toggle(row.key, e.target.checked)} /></td>}
        <td><strong>{p.codigo || '-'}</strong><small>{p.cliente || 'Sin cliente asignado'}</small>{drafts[row.key] && <Status value={row.savedBase && (row.file || row.removeImage) ? 'Referencia pendiente' : 'Borrador'} tone="amber" />}</td><td>{p.descripcion}<small>{p.tipo_codigo === 'especial' ? 'Especial' : 'Normal'}</small>{row.error && <p className="management-error" role="alert">{row.error}</p>}{errors[row.key] && <p className="management-error" role="alert">{errors[row.key]}</p>}</td>
        <td>{fmt(p.cant_etiquetas_plancha)} etiquetas/plancha<small>{fmt(p.cant_planchas)} planchas · {fmt(p.cant_rollos)} rollos</small><small>{fmt(p.cant_etiquetas_rollo)} etiquetas/rollo</small></td><td>Plancha: {fmt(p.largo_plancha_impresa, 4)} cm<small>Rollo: {fmt(p.largo_rollo, 4)} m × {fmt(p.ancho_rollo, 4)} m</small></td><td>{materials.data?.find(m => m.id === p.material_id)?.nombre || p.material_sku || (p.material_id ? `Material #${p.material_id}` : 'Sin vínculo')}</td><td>{fmt(p.tiempo_base_minutos, 6)} min<small>{p.maquina_requerida || (p.tipo_codigo === 'especial' || p.codigo === '90006718' ? 'Mesp (regla del código)' : 'Sin restricción')}</small></td><td>{row.file ? <span>Por subir: {row.file.name}</span> : row.removeImage ? 'Por eliminar' : p.imagen_url ? <a href={p.imagen_url} target="_blank" rel="noreferrer">Ver referencia</a> : 'Sin referencia'}</td>
        {editable && <td><div className="management-actions"><Button disabled={task.busy} onClick={() => open(row)}>Editar</Button><Button variant="danger" disabled={task.busy} onClick={() => void remove([row])}>Eliminar</Button>{drafts[row.key] && <Button disabled={task.busy} onClick={async () => { if (await confirmAction(row.savedBase ? '¿Descartar los cambios pendientes de referencia? Los datos base ya están guardados.' : '¿Descartar este borrador?', { title: 'Descartar borrador', confirmLabel: 'Descartar', danger: true })) { clearDraft(row.key); toggle(row.key, false) } }}>Descartar borrador</Button>}</div></td>}
      </tr> })}</tbody></table></ScrollTable>}
    </Panel>
    {editor && editable && <Modal title={editor.value.id ? 'Editar producto' : 'Nuevo producto'} onClose={close} wide><form className="management-form" onSubmit={saveOne}><fieldset disabled={task.busy}>
      <details className="inline-help"><summary>Ayuda</summary><p className="subtle">El código guardado no se puede cambiar. Usa «-» si no hay código. El cliente es texto libre; puedes repetir un código para distintos clientes. Los códigos especiales usan Mesp si no eliges otra máquina. La referencia se guarda después de los datos del producto.</p></details>
      {editor.savedBase && <p className="subtle">El producto #{editor.value.id} ya está guardado. Puedes reintentar la referencia sin crear otro producto.</p>}
      <div className="form-grid"><label>Código<input value={editor.value.codigo} readOnly={Boolean(editor.value.id)} maxLength={100} onChange={e => patch({ codigo: e.target.value })} /></label><label>Cliente<input value={editor.value.cliente || ''} list="management-catalog-clients" autoComplete="off" maxLength={150} onChange={e => patch({ cliente: e.target.value })} /></label><label className="wide">Descripción<textarea required maxLength={300} value={editor.value.descripcion} onChange={e => patch({ descripcion: e.target.value })} /></label>
      {numbers.map(([field, label, integer]) => <label key={field}>{label}<input type="number" required={field === 'tiempo_base_minutos'} min={field === 'tiempo_base_minutos' ? '0.000001' : '0'} step={integer ? '1' : 'any'} value={Number.isFinite(editor.value[field]) ? editor.value[field] : ''} onChange={e => patch({ [field]: e.target.value === '' && field === 'tiempo_base_minutos' ? Number.NaN : Number(e.target.value) })} /></label>)}
      <label>Material<select value={editor.value.material_id || ''} onChange={e => patch({ material_id: Number(e.target.value) || null })}><option value="">Sin material vinculado</option>{editor.value.material_id && !materials.data?.some(m => m.id === editor.value.material_id) && <option value={editor.value.material_id}>{editor.value.material_sku || `Material #${editor.value.material_id}`}</option>}{materials.data?.map(m => <option key={m.id} value={m.id}>{m.codigo_barras} · {m.nombre}</option>)}</select></label><label>Tipo de código<select value={editor.value.tipo_codigo} onChange={e => patch({ tipo_codigo: e.target.value })}><option value="normal">Normal</option><option value="especial">Especial</option></select></label>
      <label>Máquina requerida<select value={editor.value.maquina_requerida || ''} onChange={e => patch({ maquina_requerida: e.target.value || null })}><option value="">Según reglas del código</option><option value="M1">M1</option><option value="M2">M2</option><option value="Mesp">Mesp</option></select></label><label>Referencia (JPG, PNG o PDF)<input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; setEditor(previous => previous ? { ...previous, file, removeImage: false, error: '' } : null) }} /></label></div>
      <DataState resource={materials} />
      <datalist id="management-catalog-clients">{clients.data?.map(client => <option key={client.id} value={client.nombre}>{client.codigo}</option>)}</datalist>
      <DataState resource={clients} />
      <div className="management-preview">{preview && editor.file?.type.startsWith('image/') ? <img src={preview} alt="Vista previa de referencia pendiente" /> : !editor.removeImage && !editor.file && editor.value.imagen_url && !/\.pdf(?:$|\?)/i.test(editor.value.imagen_url) ? <img src={editor.value.imagen_url} alt="Referencia actual" /> : null}{editor.file && <span>{editor.file.name} · {(editor.file.size / 1024).toFixed(1)} KB <Button onClick={() => setEditor(previous => previous ? { ...previous, file: undefined } : null)}>Quitar archivo elegido</Button></span>}{preview && <a href={preview} target="_blank" rel="noreferrer">Abrir archivo elegido</a>}{editor.value.imagen_url && <a href={editor.value.imagen_url} target="_blank" rel="noreferrer">Abrir referencia guardada</a>}</div>
      {editor.value.imagen_url && <label className="management-check"><input type="checkbox" checked={Boolean(editor.removeImage)} onChange={e => { const checked = e.target.checked; setEditor(previous => previous ? { ...previous, removeImage: checked, file: undefined } : null) }} />Eliminar referencia al guardar</label>}
      {editor.error && <p className="management-error" role="alert">{editor.error}</p>}<Feedback task={task} />
      <div className="modal-actions"><Button onClick={close}>Cancelar</Button><Button type="submit" value="draft">Dejar en borrador</Button><Button type="submit" value="save" variant="primary">{task.busy ? 'Guardando…' : editor.error ? 'Reintentar' : 'Guardar producto'}</Button></div>
    </fieldset></form></Modal>}
  </section>
}
