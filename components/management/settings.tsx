'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Boxes, Database, UsersRound, UserRoundCog } from 'lucide-react'
import { download, upload, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, Status, useTask } from '@/components/shared'
import { Catalog } from './catalog'
import { Users } from './users'
import { Clients } from './clients'
import './settings.css'

type Tab = 'catalogue' | 'clientes' | 'usuarios' | 'instalacion'
type Health = { status: string; proyecto?: string }
type Installation = { requiere_configuracion: boolean }
type ImportResult = { mensaje: string; creados: number; actualizados: number; omitidos: number }
const tabLabels: Record<Tab, string> = { catalogue: 'Productos', clientes: 'Clientes', usuarios: 'Usuarios', instalacion: 'Datos' }
const tabIcons = { catalogue: Boxes, clientes: UsersRound, usuarios: UserRoundCog, instalacion: Database }
function normalizedTab(value?: string): Tab {
  if (value === 'clientes' || value === 'usuarios' || value === 'instalacion') return value
  return 'catalogue'
}

export function Settings({ initialTab }: { initialTab?: string }) {
  const { can, isManager } = useSession()
  const catalogAllowed = can('configuracion') || can('produccion') || can('reportes') || can('calculadora') || can('pedidos', 'editar')
  const metadataAllowed = can('configuracion') || isManager
  const clientsAllowed = can('configuracion') || can('pedidos') || can('produccion') || can('reportes')
  const allowed: Tab[] = [...(catalogAllowed ? ['catalogue' as const] : []), ...(clientsAllowed ? ['clientes' as const] : []), ...(isManager ? ['usuarios' as const] : []), ...(metadataAllowed ? ['instalacion' as const] : [])]
  const [tab, setTab] = useState<Tab>(normalizedTab(initialTab))
  useEffect(() => { setTab(normalizedTab(initialTab)) }, [initialTab])
  const activeTab = allowed.includes(tab) ? tab : allowed[0]
  return <div className="view-stack management-view">
    <Heading title="Configuración" />
    {!allowed.length ? <Empty>No tienes acceso a las secciones de administración.</Empty> : <>
      <Panel className="management-tabs"><nav aria-label="Secciones de configuración" className="management-actions">{allowed.map(value => { const Icon = tabIcons[value]; return <Button key={value} aria-current={activeTab === value ? 'page' : undefined} onClick={() => setTab(value)}><Icon aria-hidden="true" />{tabLabels[value]}</Button> })}</nav></Panel>
      {catalogAllowed && <Catalog active={activeTab === 'catalogue'} />}{clientsAllowed && <Clients active={activeTab === 'clientes'} />}{isManager && <Users active={activeTab === 'usuarios'} />}{metadataAllowed && <InstallationSettings active={activeTab === 'instalacion'} />}
    </>}
  </div>
}

function InstallationSettings({ active }: { active: boolean }) {
  const { can } = useSession()
  const health = useResource<Health>(active ? 'health' : null, 30000)
  const installation = useResource<Installation>(active ? 'instalacion' : null, 0)
  const task = useTask()
  const canImport = can('inventario', 'editar')
  const canExport = can('inventario') || can('reportes') || can('configuracion')
  const [importOpen, setImportOpen] = useState(false), [file, setFile] = useState<File | null>(null), [result, setResult] = useState<ImportResult | null>(null)
  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !canImport || !await confirmAction('Los SKU existentes sumarán el stock indicado. Reimportar el mismo archivo vuelve a sumar sus cantidades.', { title: 'Importar inventario', confirmLabel: 'Importar y sumar stock' })) return
    await task.run(async () => {
      const response = await upload<ImportResult>('importar/excel', file)
      setResult(response); setFile(null); setImportOpen(false)
      return true
    }, 'Importación completada. Revisa los resultados.')
  }
  if (!active) return null
  return <section className="view-stack management-view">
    <Heading title="Datos" actions={<Button disabled={health.loading || installation.loading} onClick={() => { void health.reload(); void installation.reload() }}>Actualizar</Button>} />
    <div className="settings-grid"><Panel className="management-meta"><h3>Conexión</h3><DataState resource={health} />{health.data && <>
      <Status value={health.error ? 'No se pudo actualizar el estado' : health.data.status === 'ok' ? 'Disponible' : 'Requiere atención'} tone={health.error || health.data.status !== 'ok' ? 'amber' : 'green'} />
      <details className="inline-help"><summary>Ayuda</summary><dl><dt>Base local</dt><dd>sgp-nueva.sqlite3</dd><dt>Proyecto</dt><dd>{health.data.proyecto || 'No informado'}</dd><dt>Estado informado</dt><dd>{health.data.status}</dd></dl><p className="subtle">Esta consulta comprueba la conexión; no informa tamaño, versión ni diagnóstico de la base de datos.</p></details>
    </>}</Panel><Panel className="management-meta"><h3>Acceso inicial</h3><DataState resource={installation} />{installation.data && <><Status value={installation.data.requiere_configuracion ? 'Pendiente' : 'Configurado'} tone={installation.data.requiere_configuracion ? 'amber' : 'green'} />{installation.data.requiere_configuracion ? <p className="subtle">Crea la primera cuenta en la pantalla de acceso.</p> : <details className="inline-help"><summary>Ayuda</summary><p className="subtle">Administra las cuentas en Usuarios y permisos.</p></details>}</>}</Panel></div>
    <Panel className="management-meta"><h3>Inventario en Excel</h3><p className="subtle">Importar suma stock a los SKU existentes. Repetir un archivo vuelve a sumar sus cantidades.</p><details className="inline-help"><summary>Ayuda</summary><p className="subtle">Columnas obligatorias: SKU y nombre. Las filas sin estos datos o con cantidades inválidas pueden omitirse; revisa los resultados al terminar. Exporta el inventario como referencia del formato.</p></details>
      <div className="management-actions management-message">{canImport && <Button variant="primary" disabled={task.busy} onClick={() => { task.clear(); setImportOpen(true) }}>Importar Excel</Button>}{canExport && <Button disabled={task.busy} onClick={() => void task.run(async () => { await download('exportar/excel', 'inventario-sgp.xlsx'); return true }, 'Inventario descargado.')}>Exportar inventario</Button>}</div>
      {!canImport && <p className="subtle">Importar requiere permiso de edición de Inventario.</p>}<Feedback task={task} />
      {result && <div className="management-summary" role="status"><span>Creados: <strong>{result.creados}</strong></span><span>Actualizados: <strong>{result.actualizados}</strong></span><span>Omitidos: <strong>{result.omitidos}</strong></span></div>}
    </Panel>
    <Panel className="management-meta"><details className="inline-help"><summary>Ayuda</summary><h3>Funciones pendientes</h3><p className="subtle">AQL: matriz y criterios de aceptación. Zebra: conexión, plantillas y cola de impresión. Compras: módulo aún no disponible.</p></details></Panel>
    {importOpen && canImport && <Modal title="Importar inventario desde Excel" onClose={() => { if (!task.busy) setImportOpen(false) }}><form className="management-form" onSubmit={importFile}><fieldset disabled={task.busy}><p className="subtle">Revisa el archivo antes de confirmar. Reimportarlo vuelve a sumar el stock de los SKU existentes.</p><div className="form-grid"><label className="wide">Archivo Excel (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required={!file} onChange={e => setFile(e.target.files?.[0] || null)} /></label></div>{file && <p className="subtle">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}<Feedback task={task} /><div className="modal-actions"><Button onClick={() => setImportOpen(false)}>Cancelar</Button><Button type="submit" variant="primary" disabled={!file}>{task.busy ? 'Importando…' : 'Importar y sumar stock'}</Button></div></fieldset></form></Modal>}
  </section>
}
