import type { Order, Product } from './types'

export const productionFields = [
  ['cant_etiquetas_plancha', 'Etiquetas por plancha'], ['cant_planchas', 'Planchas base'],
  ['cant_rollos', 'Rollos base'], ['cant_etiquetas_rollo', 'Etiquetas por rollo'],
  ['largo_plancha_impresa', 'Largo de plancha (cm)'], ['largo_rollo', 'Largo de rollo (m)'], ['ancho_rollo', 'Ancho de rollo (m)'],
] as const
export type ProductionData = Record<(typeof productionFields)[number][0], number | null>
export interface MissingData { cliente: string | null; codigo: string; descripcion: string; campos: string[] }
export interface ConsumptionItem {
  producto: Pick<Product, 'id' | 'codigo' | 'descripcion' | 'cliente'> & { material_sku: string | null }
  codigo: string; cliente: string | null; descripcion: string; cantidad_total: number; cantidad_etiquetas: number; pedidos_origen: string[]
  cant_etiquetas_plancha: number; planchas_por_rollo: number; capacidad_rollo_fraccion: string
  planchas_totales: number; etiquetas_capacidad: number; etiquetas_excedentes: number
  rollos_decimal: number; rollos_fraccion: string; rollos_completos: number; rollos_necesarios: number
  planchas_sobrantes: number; planchas_restantes_fraccion: string
  largo_plancha_cm: number; ancho_rollo_m: number; metros_lineales: number; metros_cuadrados: number
  datos_produccion: ProductionData; fuente_rendimiento_rollo: string; largo_plancha_calculado: boolean
  advertencias: string[]; formulas: string[]; paquetes_200: number; residuo_empaque: number; bultos: number; total_bultos: number
  material_id: number | null; material_sku: string | null; material_nombre: string
}
export interface ConsumptionMaterial {
  clave: string; sku: string; nombre: string; ancho_m: number | null; planchas_totales: number
  rollos_completos: number; planchas_adicionales: number; metros_lineales: number; metros_cuadrados: number
  stock_actual_rollos: number | null; rollos_estimados: number; rollos_fraccion: string; rollos_necesarios: number
  suficiente_stock: boolean | null; advertencias: string[]
}
interface ConsumptionSnapshot { revision_calculo: string; generado_en_ecuador: string; version_calculo: string }
export interface IndividualConsumption extends ConsumptionItem, ConsumptionSnapshot {
  parametros: { producto_id: number; cantidad: number }; materiales_bodega: ConsumptionMaterial[]
}
export interface BatchConsumption extends ConsumptionSnapshot {
  parametros: { pedidos_ids: number[] }
  totales: { total_pedidos: number; total_etiquetas: number; total_planchas: number; total_rollos: number; total_rollos_fraccion: string; total_rollos_necesarios: number; total_metros_lineales: number; total_metros_cuadrados: number; total_bultos_empaque: number }
  pedidos_seleccionados: Pick<Order, 'id' | 'revision' | 'cliente' | 'orden_compra' | 'fecha_entrega' | 'total_unidades' | 'estado'>[]
  items_agrupados: ConsumptionItem[]; materiales_bodega: ConsumptionMaterial[]
}
