export function canAccess(user: { permisos?: Partial<Record<string, string>> } | null, module: string, level = 'ver'): boolean {
  const access = user?.permisos?.[module]
  return access === 'editar' || (level === 'ver' && access === 'ver')
}

export function parseEcuadorDate(value?: string | null): Date | null {
  if (!value) return null
  let source = value.trim()
  const legacy = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(source)
  if (legacy) source = `${legacy[3]}-${legacy[2]}-${legacy[1]}T${legacy[4] || '00'}:${legacy[5] || '00'}:${legacy[6] || '00'}`
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(source)) return null
  source = source.replace(' ', 'T')
  if (source.length === 10) source += 'T00:00:00'
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(source)) source += '-05:00'
  const date = new Date(source)
  return Number.isNaN(date.getTime()) ? null : date
}

export const fmt = (value: number | string | null | undefined, digits = 2) => new Intl.NumberFormat('es-EC', { maximumFractionDigits: digits }).format(Number(value) || 0)
export function fmtDate(value?: string | null, time = true): string {
  const date = parseEcuadorDate(value)
  return date ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date) : '—'
}

export function countdown(value?: string | null, now = Date.now()): string {
  const deadline = parseEcuadorDate(value)
  if (!deadline) return 'Sin fecha'
  const delta = deadline.getTime() - now
  if (delta < 0) return 'Retrasado'
  const minutes = Math.floor(delta / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24)
  return days ? `${days} d ${hours % 24} h` : `${hours} h ${minutes % 60} min`
}
export function dueTone(value?: string | null, now = Date.now()): string {
  const date = parseEcuadorDate(value)
  if (!date) return 'blue'
  const days = (date.getTime() - now) / 86400000
  return days < 1 ? 'rose' : days <= 3 ? 'amber' : 'green'
}

export function progressOf(items: { estado_item?: string; cantidad?: number; modo_entregas_parciales?: boolean; cantidad_entregada_total?: number }[]): number {
  const active = items.filter(item => item.estado_item !== 'suspendido')
  if (!active.length) return 0
  return active.reduce((sum, item) => sum + (item.modo_entregas_parciales ? Math.min(1, (item.cantidad_entregada_total || 0) / Math.max(1, item.cantidad || 0)) : ['listo', 'entregado_parcial'].includes(item.estado_item || '') ? 1 : 0), 0) / active.length * 100
}
export const orderStates = ['En Cola', 'Procesando', 'Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado'] as const
export const moduleLabels = { pedidos: 'Monitor y pedidos', produccion: 'Producción', operaciones: 'Operaciones', inventario: 'Inventario', reportes: 'Reportes', configuracion: 'Catálogo y clientes', calculadora: 'Calculadora' } as const
export function dateInput(value?: string | null) {
  const date = parseEcuadorDate(value)
  if (!date) return ''
  return new Date(date.getTime() - 5 * 3600000).toISOString().slice(0, 16)
}
