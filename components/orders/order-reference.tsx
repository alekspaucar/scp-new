import type { Product } from '@/lib/types'

const norm = (value: string) => value.trim().toLocaleUpperCase()
export type ProductReferenceData = Pick<Product, 'imagen_url' | 'imagen_referencia' | 'descripcion' | 'material_sku'>

// Mirror PDF/stock lookup: client and code ignore case; '-' requires the
// exact catalog description after trimming the item's description. Never
// guess when there is more than one match.
export function productForItem(products: Product[], client: string, item: { codigo: string; descripcion: string }): Product | undefined {
  if (!client.trim()) return undefined
  const code = norm(item.codigo), noCode = ['', '-', 'S/C'].includes(code)
  const candidates = products.filter(product => norm(product.cliente || '') === norm(client) && (noCode ? product.codigo === '-' && product.descripcion === item.descripcion.trim() : norm(product.codigo) === code))
  return candidates.length === 1 ? candidates[0] : undefined
}

export function ProductReference({ product }: { product?: ProductReferenceData }) {
  if (!product?.imagen_url) return null
  const pdf = /\.pdf(?:[?#]|$)/i.test(product.imagen_referencia || product.imagen_url)
  return <details className="orders-reference"><summary>Referencia del producto{pdf ? ' · PDF' : ''}</summary><a href={product.imagen_url} target="_blank" rel="noopener noreferrer">{pdf ? 'Abrir referencia PDF' : <><img src={product.imagen_url} alt={`Referencia de ${product.descripcion}`} loading="lazy" /><span>Abrir imagen completa</span></>}</a>{product.material_sku && <p className="subtle">Material: {product.material_sku}</p>}</details>
}
