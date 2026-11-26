import { notFound } from 'next/navigation'

/**
 * Any unknown address under /espace gets the space's own 404 (../not-found.tsx)
 * rather than the root one: a client must not land on an operator-styled page.
 */
export default function UnknownClientPage(): never {
  notFound()
}
