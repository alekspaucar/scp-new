'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, CalendarDays, ChartNoAxesCombined, ClipboardList, Database, Factory, Gauge, Layers3, LogOut, Menu, Moon, PanelLeftClose, ScanBarcode, Settings2, ShieldCheck, Sun, X } from 'lucide-react'
import { useResource } from '@/lib/api'
import { fmtDate, parseEcuadorDate } from '@/lib/domain'
import type { Material, Module, Order } from '@/lib/types'
import { useSession } from './session-provider'
import { Button, DataState, Empty, Feedback, Modal, Panel, useTask } from './shared'
import { Monitor } from './orders/monitor'
import { OrderList } from './orders/order-list'
import { Production } from './orders/production'
import { Preacabados } from './orders/preacabados'
import { Inventory } from './management/inventory'
import { Operations } from './management/operations'
import { Settings } from './management/settings'
import { ModuleCount, useModuleIndicators } from '@/lib/use-module-indicators'
import { Gantt } from './planning/gantt'
import { Calculator } from './planning/calculator'
import { Reports } from './planning/reports'

const navigation: { path: string; label: string; module: Module; icon: typeof Gauge }[] = [
  { path: 'monitor', label: 'Monitor', module: 'pedidos', icon: Gauge },
  { path: 'pedidos', label: 'Pedidos', module: 'pedidos', icon: ClipboardList },
  { path: 'produccion', label: 'Producción', module: 'produccion', icon: Factory },
  { path: 'gantt', label: 'Planificador Gantt', module: 'produccion', icon: CalendarDays },
  { path: 'calculadora', label: 'Calculadora MRP', module: 'calculadora', icon: ChartNoAxesCombined },
  { path: 'preacabados', label: 'Pre-acabados', module: 'produccion', icon: ShieldCheck },
  { path: 'inventario', label: 'Inventario', module: 'inventario', icon: Layers3 },
  { path: 'operaciones', label: 'Operaciones', module: 'operaciones', icon: ScanBarcode },
  { path: 'reportes', label: 'Reportes', module: 'reportes', icon: Database },
  { path: 'configuracion', label: 'Configuración', module: 'configuracion', icon: Settings2 },
]

function LoginScreen() {
  const { login, error: sessionError, refresh } = useSession()
  const installation = useResource<{ requiere_configuracion: boolean }>('instalacion', 0)
  const [username, setUsername] = useState(''), [password, setPassword] = useState('')
  const task = useTask(), initial = installation.data?.requiere_configuracion === true
  return <main className="app-shell login-shell"><Panel className="login-card"><div className="brand login-brand"><div className="brand-mark"><Factory /></div><div><strong>PRO<span>PRINT</span></strong><small>Producción inteligente</small></div></div><div className="login-copy"><h1>{initial ? 'Crea tu acceso' : 'Ingresa a Proprint'}</h1>{initial && <p className="subtle">Primer usuario · Contraseña de al menos 10 caracteres.</p>}</div><DataState resource={installation} />{sessionError && <div className="feedback error" role="alert">{sessionError}<Button onClick={() => void refresh()}>Reintentar</Button></div>}<form className="login-form" onSubmit={event => { event.preventDefault(); void task.run(() => login(username.trim(), password, initial)) }}><label>Usuario<input autoComplete="username" required autoFocus value={username} onChange={event => setUsername(event.target.value)} disabled={task.busy} /></label><label>Contraseña<input type="password" autoComplete={initial ? 'new-password' : 'current-password'} required minLength={initial ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} disabled={task.busy} /></label><Feedback task={task} /><Button type="submit" variant="primary" disabled={task.busy || !installation.data}>{task.busy ? 'Comprobando…' : initial ? 'Crear acceso' : 'Ingresar'}</Button></form></Panel></main>
}

function Notifications({ onClose }: { onClose: () => void }) {
  const { can } = useSession()
  const orders = useResource<Order[]>(can('pedidos') || can('produccion') || can('reportes') ? 'pedidos' : null, 0)
  const materials = useResource<Material[]>(can('inventario') ? 'materiales' : null, 0)
  const overdue = (orders.data || []).filter(order => !['Entregado', 'Retiro en Fábrica'].includes(order.estado) && (parseEcuadorDate(order.fecha_entrega)?.getTime() || Infinity) < Date.now())
  const shortages = (orders.data || []).filter(order => order.tiene_faltantes_activos)
  const critical = (materials.data || []).filter(material => ['Crítico', 'Agotado'].includes(material.estado))
  return <Modal title="Alertas de tu área" onClose={onClose}><DataState resource={orders} /><DataState resource={materials} /><div className="alert-list">{overdue.map(order => <div key={`due-${order.id}`}><AlertTriangle /><div><strong>Pedido #{order.id} retrasado</strong><p>{order.cliente} · {fmtDate(order.fecha_entrega)}</p></div></div>)}{shortages.map(order => <div key={`short-${order.id}`}><ShieldCheck /><div><strong>Faltante por reponer · #{order.id}</strong><p>{order.cliente}</p></div></div>)}{critical.map(material => <div key={`stock-${material.id}`}><Layers3 /><div><strong>{material.nombre}</strong><p>{material.estado} · {material.stock_actual} {material.unidad_medida}</p></div></div>)}</div>{!orders.loading && !materials.loading && !overdue.length && !shortages.length && !critical.length && <Empty>No hay alertas pendientes en las áreas que puedes consultar.</Empty>}</Modal>
}

function ConnectedWorkspace({ section }: { section: string }) {
  const { user, can, logout, error: sessionError } = useSession()
  const [collapsed, setCollapsed] = useState(false), [mobileOpen, setMobileOpen] = useState(false), [dark, setDark] = useState(false), [notifications, setNotifications] = useState(false)
  const health = useResource<{ status: string }>('health', 30000), task = useTask()
  const indicators = useModuleIndicators(), counts = indicators.data?.contadores || {}
  const activeSection = section === 'clientes' ? 'configuracion' : section
  const entries = navigation.filter(item => can(item.module)), current = navigation.find(item => item.path === activeSection)
  const [date, setDate] = useState('')
  useEffect(() => {
    setDark(localStorage.getItem('sgp-nueva-theme') === 'dark')
    setCollapsed(localStorage.getItem('sgp-nueva-sidebar') === 'collapsed')
    setDate(new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()))
  }, [])
  useEffect(() => { setMobileOpen(false) }, [section])
  useEffect(() => {
    if (!mobileOpen) return
    const desktop = window.matchMedia('(min-width: 901px)')
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    const resize = () => { if (desktop.matches) setMobileOpen(false) }
    document.body.classList.add('mobile-navigation-open')
    document.addEventListener('keydown', escape)
    desktop.addEventListener('change', resize)
    return () => {
      document.body.classList.remove('mobile-navigation-open')
      document.removeEventListener('keydown', escape)
      desktop.removeEventListener('change', resize)
    }
  }, [mobileOpen])
  useEffect(() => { document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.body.classList.toggle('theme-dark', dark); return () => { document.body.classList.remove('theme-dark') } }, [dark])
  const toggleTheme = () => { const next = !dark; setDark(next); localStorage.setItem('sgp-nueva-theme', next ? 'dark' : 'light') }
  const toggleSidebar = () => { const next = !collapsed; setCollapsed(next); localStorage.setItem('sgp-nueva-sidebar', next ? 'collapsed' : 'open') }
  const views: Record<string, React.ReactNode> = {
    monitor: <Monitor />, pedidos: <OrderList />, produccion: <Production />, gantt: <Gantt />, calculadora: <Calculator />, preacabados: <Preacabados />, inventario: <Inventory />, operaciones: <Operations />, reportes: <Reports />, clientes: <Settings initialTab="clientes" />, configuracion: <Settings />,
  }
  return <main className={`app-shell ${dark ? 'dark-mode' : ''}`}>
    {mobileOpen && <button className="sidebar-shade" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-navigation" className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Factory /></div>{(!collapsed || mobileOpen) && <div><strong>PRO<span>PRINT</span></strong><small>Producción inteligente</small></div>}<button className="mobile-sidebar-close ghost-icon" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)}><X /></button></div>
      <div className="sidebar-section">{!collapsed && <p className="sidebar-label">Área de trabajo</p>}
        <nav aria-label="Navegación principal">{entries.map(({ path, label, icon: Icon }) => <Link key={path} href={`/${path}`} className={`nav-item ${activeSection === path ? 'active' : ''}`} aria-current={activeSection === path ? 'page' : undefined} aria-label={`${label}${counts[path]?.cantidad ? `. ${counts[path].etiqueta}: ${counts[path].cantidad}` : ''}`} title={label}>
          <Icon aria-hidden="true" />{(!collapsed || mobileOpen) && <span className="nav-label">{label}</span>}<ModuleCount value={counts[path]} />
        </Link>)}</nav>
      </div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setNotifications(true)}><Bell />{(!collapsed || mobileOpen) && <span>Alertas</span>}<ModuleCount value={counts.alertas} /></button><button className="nav-item" onClick={() => void task.run(logout)} disabled={task.busy}><LogOut />{(!collapsed || mobileOpen) && <span>Cerrar sesión</span>}</button>{(!collapsed || mobileOpen) && <div className="profile"><div>{user?.username.slice(0, 2).toUpperCase()}</div><span><strong>{user?.username}</strong><small>{user?.rol}</small></span></div>}</div>
    </aside>
    <div className={`main-area ${collapsed ? 'expanded' : ''}`}><header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir menú" aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={() => setMobileOpen(true)}><Menu /></button><button className="icon-button collapse-button" onClick={toggleSidebar} aria-label="Alternar barra lateral"><PanelLeftClose /></button><div className="breadcrumb"><span>Planta de producción</span><strong>{current?.label || 'Espacio de trabajo'}</strong></div><div className="top-actions"><span className={`live-status ${health.error ? 'disconnected' : ''}`}><i />{health.loading ? 'Conectando…' : health.error ? 'Sin conexión' : 'Servicio conectado'}</span><span className="date-label">{date}</span><button className="icon-button" onClick={toggleTheme} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>{dark ? <Sun /> : <Moon />}</button><button className="icon-button" aria-label="Abrir alertas" onClick={() => setNotifications(true)}><Bell /></button></div></header>
      <div className="page-content"><Feedback task={task} />{sessionError && <div role="alert" className="feedback error">{sessionError}</div>}{current && can(current.module) ? views[section] : <Panel className="no-access"><h2>{current ? 'Esta sección no está habilitada para tu cuenta' : 'Tu espacio de trabajo'}</h2><p className="subtle">{entries.length ? 'Selecciona una de las áreas disponibles para continuar.' : 'Solicita al administrador que habilite tus áreas de trabajo.'}</p><div className="quick-links">{entries.map(item => <Link className="soft-button" href={`/${item.path}`} key={item.path}>{item.label}</Link>)}</div></Panel>}</div>
      <footer className="app-footer"><span>PROPRINT</span><span>Hora de Ecuador</span></footer>
    </div>{notifications && <Notifications onClose={() => setNotifications(false)} />}
  </main>
}
export function Workspace({ section }: { section: string }) {
  const { user, loading } = useSession()
  if (loading) return <main className="app-shell login-shell"><Panel className="loading-state">Comprobando acceso…</Panel></main>
  return user ? <ConnectedWorkspace section={section} /> : <LoginScreen />
}
