/** `?page=` read as a positive integer; anything else is page 1. */
export function readPageNumber(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(value) && value > 1 ? value : 1
}
