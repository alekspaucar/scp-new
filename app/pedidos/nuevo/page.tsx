import { redirect } from 'next/navigation'

export default async function OriginalOrderForm({ searchParams }: { searchParams: Promise<{ editar?: string | string[] }> }) {
  const query = await searchParams
  const edit = Array.isArray(query.editar) ? query.editar[0] : query.editar
  redirect(edit ? `/pedidos?editar=${encodeURIComponent(edit)}` : '/pedidos?nuevo=1')
}
