'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Download, History, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, ApiError, download, jsonRequest, upload, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { fmt, parseEcuadorDate } from '@/lib/domain'
import type { Material, Movement } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Metric, Modal, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import { MovementHistory } from './operations'
import './bodega.css'

const PAGE_SIZE = 15
const CATEGORIES = ['Materia Prima', 'Tintas', 'Herramientas']

interface MaterialForm {
  codigo_barras: string; nombre: string; categoria: string; tipo: string; proveedor: string
  stock_actual: string; stock_minimo: string; metros_por_rollo: string; ancho_material_cm: string; acabado: string; color: string
}

function MaterialEditor({ material, materials, canWrite, onClose, onSaved }: { material: Material | null; materials: Material[]; canWrite: () => boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const { can } = useSession()
  const editable = can('inventario', 'editar')
  const task = useTask()
  const [validation, setValidation] = useState('')
  const [revision, setRevision] = useState(material?.revision)
  const [conflict, setConflict] = useState<Material | null>(null)
  const [form, setForm] = useState<MaterialForm>({
    codigo_barras: material?.codigo_barras || '', nombre: material?.nombre || '', categoria: material?.categoria || 'Materia Prima',
    tipo: material?.tipo || 'Sustrato', proveedor: material?.proveedor || '', stock_actual: material ? String(material.stock_actual) : '',
    stock_minimo: material ? String(material.stock_minimo) : '', metros_por_rollo: material ? String(material.metros_por_rollo) : '',
    ancho_material_cm: material?.ancho_material_cm == null ? '' : String(material.ancho_material_cm), acabado: material?.acabado || '', color: material?.color || '',
  })
  const rawMaterial = form.categoria === 'Materia Prima'
  const widthRequired = rawMaterial && form.tipo === 'Sustrato'
  const unit = material && form.categoria === material.categoria ? material.unidad_medida : rawMaterial ? 'rollos' : 'unidades'
  const existing = !material ? materials.find(item => item.codigo_barras.toUpperCase() === form.codigo_barras.trim().toUpperCase()) : undefined
  function update(field: keyof MaterialForm, value: string) { setForm(current => ({ ...current, [field]: value })) }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || task.busy) return
    task.clear(); setValidation('')
    if (!form.codigo_barras.trim() || !form.nombre.trim() || !form.proveedor.trim()) { setValidation('Completa SKU, nombre y proveedor.'); return }
    const stock = Number(form.stock_actual), minimum = Number(form.stock_minimo)
    if (!form.stock_actual.trim() || !Number.isSafeInteger(stock) || stock < (material ? 0 : 1)) {
      setValidation(`El stock debe ser un entero mayor o igual a ${material ? '0' : '1'}.`); return
    }
    if (!form.stock_minimo.trim() || !Number.isSafeInteger(minimum) || minimum < 0) { setValidation('El stock mínimo debe ser un entero mayor o igual a 0.'); return }
    const length = Number(form.metros_por_rollo || 0), width = Number(form.ancho_material_cm)
    if (rawMaterial && (!Number.isFinite(length) || length < 0)) { setValidation('Los metros por rollo deben ser un número mayor o igual a 0.'); return }
    if (widthRequired && (!form.ancho_material_cm.trim() || !Number.isFinite(width) || width < 0)) { setValidation('Ingresa un ancho de material mayor o igual a 0 cm para Sustrato.'); return }
    if (existing && !await confirmAction(`El SKU ${existing.codigo_barras} ya existe. Se sumarán ${stock} ${existing.unidad_medida} a su stock; la ficha existente se conserva. ¿Continuar?`, { title: 'Sumar al stock existente', confirmLabel: 'Sumar stock' })) return
    if (!canWrite()) return
    await task.run(async () => {
      const payload = {
        ...(material ? { revision } : { codigo_barras: form.codigo_barras.trim().toUpperCase() }),
        nombre: form.nombre.trim(), categoria: form.categoria, tipo: form.tipo, proveedor: form.proveedor.trim(),
        stock_actual: stock, stock_minimo: minimum, metros_por_rollo: rawMaterial ? length : 0,
        ancho_material_cm: widthRequired ? width : null, acabado: rawMaterial ? form.acabado.trim() || null : null,
        color: form.color.trim() || null,
      }
      let result: { mensaje: string; material: Material }
      try { result = await api<{ mensaje: string; material: Material }>(material ? `materiales/${material.id}` : 'materiales', jsonRequest(material ? 'PUT' : 'POST', payload)) }
      catch (error) {
        if (material && error instanceof ApiError && error.status === 409) {
          const latest = await api<Material[]>('materiales')
          setConflict(latest.find(value => value.id === material.id) || null)
        }
        throw error
      }
      onSaved(result.mensaje)
      return result
    })
  }

  return <Modal title={material ? `Editar ${material.codigo_barras}` : 'Nuevo material'} onClose={() => { if (!task.busy) onClose() }} wide>
    <div className="bodega">
      <Feedback task={{ error: validation || task.error }} />
      {conflict && <div className="bodega-note"><p>La ficha cambió mientras la editabas. Saldo actual: <strong>{fmt(conflict.stock_actual)} {conflict.unidad_medida}</strong>. Proveedor guardado: {conflict.proveedor || '—'}. Se conservan tus demás cambios.</p><Button disabled={task.busy} onClick={() => { setRevision(conflict.revision); setForm(current => ({ ...current, stock_actual: String(conflict.stock_actual) })); setConflict(null); task.clear(); setValidation('Saldo actual cargado. Revisa los demás campos antes de guardar.') }}>Usar saldo actual</Button></div>}
      {!material && <p className="bodega-note" role={existing ? 'alert' : undefined}>{existing
        ? `Este SKU ya existe: ${existing.nombre}. El alta suma la cantidad al stock existente; no modifica los demás campos.`
        : 'Si el SKU ya existe, se sumará la cantidad a su stock y se conservará su ficha.'}</p>}
      {material && <p className="subtle">Editar stock reemplaza el saldo actual. Para registrar entradas y salidas, usa Operaciones.</p>}
      <form onSubmit={event => void save(event)} aria-busy={task.busy} onKeyDown={event => {
        // A scanner's Enter advances through the inventory form; only the
        // explicit save button submits a stock change.
        if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return
        event.preventDefault()
        const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')).filter(field => !field.disabled && !(field instanceof HTMLInputElement && field.readOnly))
        fields[fields.indexOf(event.target) + 1]?.focus()
      }}>
        <fieldset disabled={task.busy || !editable}>
          <div className="form-grid">
            <label>SKU / código de barras<input value={form.codigo_barras} readOnly={!!material} autoFocus={!material} autoComplete="off" spellCheck={false} onChange={event => update('codigo_barras', event.target.value)} required /></label>
            <label>Nombre / descripción<input value={form.nombre} autoFocus={!!material} onChange={event => update('nombre', event.target.value)} required /></label>
            <label>Categoría<select value={form.categoria} onChange={event => {
              const category = event.target.value
              setForm(current => ({ ...current, categoria: category, tipo: category === 'Tintas' ? 'Tinta' : category === 'Herramientas' ? 'Sustrato' : current.tipo === 'Cinta' ? 'Cinta' : 'Sustrato' }))
            }}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
            <label>Tipo{rawMaterial ? <select value={form.tipo} onChange={event => update('tipo', event.target.value)}><option>Sustrato</option><option>Cinta</option></select> : <input value={form.tipo} readOnly />}</label>
            <label className="wide">Proveedor<input value={form.proveedor} onChange={event => update('proveedor', event.target.value)} required /></label>
            <label>{existing ? `Cantidad a sumar (${existing.unidad_medida})` : `Stock actual (${unit})`}<input type="number" min={material ? 0 : 1} step="1" value={form.stock_actual} onChange={event => update('stock_actual', event.target.value)} required /></label>
            <label>Stock mínimo ({unit})<input type="number" min="0" step="1" value={form.stock_minimo} onChange={event => update('stock_minimo', event.target.value)} required /></label>
            {rawMaterial && <>
              <label>Metros por rollo<input type="number" min="0" step="any" value={form.metros_por_rollo} onChange={event => update('metros_por_rollo', event.target.value)} /></label>
              {widthRequired && <label>Ancho de material (cm)<input type="number" min="0" step="any" value={form.ancho_material_cm} onChange={event => update('ancho_material_cm', event.target.value)} required /></label>}
              <label>Acabado<input value={form.acabado} onChange={event => update('acabado', event.target.value)} /></label>
            </>}
            <label>Color<input value={form.color} onChange={event => update('color', event.target.value)} /></label>
          </div>
          <details className="inline-help"><summary>Ayuda</summary><p className="subtle">El SKU guardado no se puede cambiar. La categoría y el stock determinan la unidad, clasificación y estado.</p></details>
          <div className="modal-actions"><Button onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary">{task.busy ? 'Guardando…' : existing ? 'Sumar al stock existente' : 'Guardar material'}</Button></div>
        </fieldset>
      </form>
    </div>
  </Modal>
}

function MaterialHistory({ material, materials, onClose }: { material: Material; materials: Material[]; onClose: () => void }) {
  const history = useResource<Movement[]>('movimientos')
  return <Modal title={`Historial · ${material.codigo_barras}`} onClose={onClose} wide>
    <div className="bodega view-stack"><p className="subtle">{material.nombre} · Coincidencias entre los últimos 50 movimientos de bodega; historial parcial.</p>
      <Button disabled={history.loading} onClick={() => void history.reload()}><RefreshCw /> Actualizar</Button>
      <DataState resource={history} />
      {history.data && <MovementHistory movements={history.data} materials={materials} sku={material.codigo_barras} />}
    </div>
  </Modal>
}

export function Inventory() {
  const { can } = useSession()
  const allowed = can('inventario'), editable = can('inventario', 'editar')
  const writeAllowed = useRef(editable); writeAllowed.current = editable
  const resource = useResource<Material[]>(allowed ? 'materiales' : null)
  const movements = useResource<Movement[]>(allowed ? 'movimientos' : null)
  const task = useTask()
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [type, setType] = useState(''), [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<{ material: Material | null } | null>(null)
  const [historyMaterial, setHistoryMaterial] = useState<Material | null>(null)
  const [importOpen, setImportOpen] = useState(false), [importFile, setImportFile] = useState<File | null>(null)
  const [notice, setNotice] = useState('')
  const materials = resource.data || []
  const now = Date.now(), since = now - 7 * 86400000
  const recentMovements = movements.data?.filter(movement => { const date = parseEcuadorDate(movement.fecha)?.getTime(); return date != null && date >= since && date <= now }).length
  const query = search.trim().toLocaleLowerCase('es')
  const filtered = materials.filter(material => (!category || material.categoria === category) && (!type || material.tipo === type) && (!status || material.estado === status)
    && (!query || [material.codigo_barras, material.nombre, material.categoria, material.tipo, material.estado].some(value => value.toLocaleLowerCase('es').includes(query))))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), activePage = Math.min(page, pages)
  const rows = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
  useEffect(() => { setPage(1) }, [search, category, type, status])
  useEffect(() => { setPage(current => Math.min(current, pages)) }, [pages])

  async function remove(material: Material) {
    if (!writeAllowed.current || task.busy || !await confirmAction(`¿Eliminar ${material.codigo_barras} · ${material.nombre}? No se pueden eliminar materiales vinculados al catálogo o con movimientos.`, { title: 'Eliminar material', confirmLabel: 'Eliminar', danger: true }) || !writeAllowed.current) return
    setNotice('')
    await task.run(async () => {
      const result = await api<{ mensaje: string }>(`materiales/${material.id}`, jsonRequest('DELETE'))
      setNotice(result.mensaje); void resource.reload(); return result
    }, 'Material eliminado.')
  }

  async function importExcel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || task.busy || !importFile) return
    if (!await confirmAction('La importación suma stock a los SKU existentes. Volver a importar el mismo archivo suma esas cantidades otra vez. ¿Continuar?', { title: 'Importar inventario', confirmLabel: 'Importar' })) return
    if (!writeAllowed.current) return
    setNotice('')
    await task.run(async () => {
      const result = await upload<{ mensaje: string; creados: number; actualizados: number; omitidos: number }>('importar/excel', importFile)
      setNotice(`${result.mensaje}. Creados: ${result.creados}; stock actualizado: ${result.actualizados}; filas omitidas: ${result.omitidos}.`)
      setImportOpen(false); setImportFile(null); void resource.reload(); return result
    }, 'Importación completada.')
  }

  if (!allowed) return <Empty>No tienes permiso para ver Inventario.</Empty>

  return <div className="view-stack bodega">
    <Heading title="Inventario" actions={<>
      <Button disabled={task.busy} onClick={() => { setNotice(''); void task.run(async () => { await download('exportar/excel', 'inventario_sgp.xlsx'); return true }, 'Archivo de inventario descargado.') }}><Download /> Exportar Excel</Button>
      {editable && <><Button disabled={task.busy} onClick={() => { task.clear(); setNotice(''); setImportFile(null); setImportOpen(true) }}><Upload /> Importar Excel</Button><Button variant="primary" disabled={task.busy} onClick={() => { task.clear(); setNotice(''); setEditor({ material: null }) }}><Plus /> Nuevo material</Button></>}
    </>} />
    <Feedback task={{ error: task.error, success: notice || task.success }} />
    <DataState resource={movements} />
    <div className="metrics-grid">
      <Metric label="Referencias" value={resource.data ? fmt(materials.length, 0) : '—'} note="Inventario completo" />
      <Metric label="Críticos / agotados" value={resource.data ? fmt(materials.filter(material => ['Crítico', 'Agotado'].includes(material.estado)).length, 0) : '—'} tone="rose" />
      <Metric label="Stock materia prima" value={resource.data ? fmt(materials.filter(material => material.categoria === 'Materia Prima').reduce((total, material) => total + material.stock_actual, 0), 0) : '—'} note="Rollos" tone="green" />
      <Metric label="Stock tintas / herramientas" value={resource.data ? fmt(materials.filter(material => ['Tintas', 'Herramientas'].includes(material.categoria)).reduce((total, material) => total + material.stock_actual, 0), 0) : '—'} note="Unidades" tone="amber" />
      <Metric label="Movimientos (7 días)" value={recentMovements == null ? '—' : fmt(recentMovements, 0)} note="Entre los últimos 50 registros · Historial parcial" />
    </div>
    {!editable && <p className="subtle">Solo consulta. Editar e importar requiere permiso de edición de Inventario.</p>}
    <Panel className="table-card">
      <div className="table-toolbar">
        <div className="bodega-filters">
          <label className="bodega-filter">Buscar material<input type="search" placeholder="SKU, descripción, categoría, tipo o estado" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className="bodega-filter">Categoría<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{Array.from(new Set([...CATEGORIES, ...materials.map(material => material.categoria)])).map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="bodega-filter">Tipo<select value={type} onChange={event => setType(event.target.value)}><option value="">Todos</option>{Array.from(new Set(['Sustrato', 'Tinta', 'Cinta', ...materials.map(material => material.tipo)])).map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="bodega-filter">Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Array.from(new Set(['Disponible', 'Bajo', 'Crítico', 'Agotado', ...materials.map(material => material.estado)])).map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <Button disabled={resource.loading || task.busy} onClick={() => { void resource.reload(); void movements.reload() }}><RefreshCw /> Actualizar</Button>
        {(search || category || type || status) && <Button onClick={() => { setSearch(''); setCategory(''); setType(''); setStatus('') }}>Limpiar filtros</Button>}
      </div>
      <DataState resource={resource} />
      {resource.error && resource.data && <p className="bodega-note">Se muestran los últimos datos recibidos. Actualiza antes de tomar decisiones de stock.</p>}
      {resource.data && (!rows.length ? <Empty>{materials.length ? 'Sin materiales para estos filtros.' : 'No hay materiales registrados.'}</Empty> : <ScrollTable><table className="bodega-table inventory-table">
        <caption className="bodega-sr-only">Inventario de materiales, página {activePage} de {pages}</caption>
        <thead><tr><th scope="col">SKU / descripción</th><th scope="col">Categoría / tipo</th><th scope="col">Stock actual</th><th scope="col">Mínimo</th><th scope="col">Estado</th><th scope="col">Ficha técnica</th><th scope="col">Acciones</th></tr></thead>
        <tbody>{rows.map(material => <tr key={material.id}>
          <td><span className="mono">{material.codigo_barras}</span><strong className="bodega-block">{material.nombre}</strong></td>
          <td>{material.categoria}<span className="subtle bodega-block">{material.tipo}</span></td>
          <td><strong>{fmt(material.stock_actual, 0)}</strong><span className="subtle bodega-block">{material.unidad_medida || 'Unidad no disponible'}</span></td>
          <td>{fmt(material.stock_minimo, 0)}<span className="subtle bodega-block">{material.unidad_medida || 'Unidad no disponible'}</span></td>
          <td><Status value={material.estado} /></td>
          <td><details className="bodega-details"><summary>Ver ficha</summary><dl>
            <dt>Proveedor</dt><dd>{material.proveedor || '—'}</dd><dt>Clasificación</dt><dd>{material.clasificacion || '—'}</dd>
            <dt>Stock crítico</dt><dd>{fmt(material.stock_critico)} {material.unidad_medida}</dd>
            <dt>Metros / rollo</dt><dd>{material.categoria === 'Materia Prima' ? fmt(material.metros_por_rollo) : 'No aplica'}</dd>
            <dt>Ancho (cm)</dt><dd>{material.ancho_material_cm == null ? '—' : fmt(material.ancho_material_cm)}</dd>
            <dt>Acabado</dt><dd>{material.acabado || '—'}</dd><dt>Color</dt><dd>{material.color || '—'}</dd>
            {material.capacidad && <><dt>Capacidad</dt><dd>{material.capacidad}</dd></>}{material.gramaje && <><dt>Gramaje</dt><dd>{material.gramaje}</dd></>}
          </dl></details></td>
          <td><div className="bodega-actions"><Button aria-label={`Historial de ${material.codigo_barras}`} onClick={() => setHistoryMaterial(material)}><History /> Historial</Button>
            {editable && <><Button disabled={task.busy} aria-label={`Editar ${material.codigo_barras}`} onClick={() => { task.clear(); setNotice(''); setEditor({ material }) }}><Pencil /> Editar</Button><Button variant="danger" disabled={task.busy} aria-label={`Eliminar ${material.codigo_barras}`} onClick={() => void remove(material)}><Trash2 /> Eliminar</Button></>}
          </div></td>
        </tr>)}</tbody>
      </table></ScrollTable>)}
      {resource.data && <div className="bodega-pagination"><p className="subtle">{filtered.length ? `${(activePage - 1) * PAGE_SIZE + 1}–${Math.min(activePage * PAGE_SIZE, filtered.length)} de ${filtered.length}` : '0 resultados'} · {PAGE_SIZE} por página</p><div className="bodega-actions"><Button disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}>Anterior</Button><span className="subtle" aria-live="polite">Página {activePage} de {pages}</span><Button disabled={activePage >= pages} onClick={() => setPage(activePage + 1)}>Siguiente</Button></div></div>}
    </Panel>
    {editor && editable && <MaterialEditor key={editor.material?.id ?? 'new'} material={editor.material} materials={materials} canWrite={() => writeAllowed.current} onClose={() => setEditor(null)} onSaved={message => { setEditor(null); setNotice(message); void resource.reload() }} />}
    {historyMaterial && <MaterialHistory material={historyMaterial} materials={materials} onClose={() => setHistoryMaterial(null)} />}
    {importOpen && editable && <Modal title="Importar inventario desde Excel" onClose={() => { if (!task.busy) setImportOpen(false) }}>
      <div className="bodega"><p className="bodega-note">Importar suma stock a los SKU existentes. Repetir el archivo vuelve a sumar las cantidades. Revisa las filas omitidas al terminar.</p>
        <Feedback task={task} /><form onSubmit={event => void importExcel(event)} aria-busy={task.busy}>
          <div className="bodega-file-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!task.busy && writeAllowed.current && event.dataTransfer.files[0]) { setImportFile(event.dataTransfer.files[0]); task.clear() } }}>
            <p className="subtle">Arrastra el Excel aquí o elige un archivo.</p><div className="form-grid"><label className="wide">Archivo Excel (.xlsx / .xlsm)<input type="file" accept=".xlsx,.xlsm" disabled={task.busy} onChange={event => { setImportFile(event.target.files?.[0] || null); task.clear() }} required={!importFile} /></label></div>
            {importFile && <p className="subtle">{importFile.name} · {(importFile.size / 1024).toFixed(1)} KB</p>}
          </div><p className="subtle">Columnas obligatorias: SKU (código) y Nombre. La exportación sirve de referencia para las demás columnas.</p><div className="modal-actions"><Button disabled={task.busy} onClick={() => setImportOpen(false)}>Cancelar</Button><Button type="submit" variant="primary" disabled={task.busy || !importFile}>{task.busy ? 'Importando…' : 'Importar y sumar stock'}</Button></div></form>
      </div>
    </Modal>}
  </div>
}
