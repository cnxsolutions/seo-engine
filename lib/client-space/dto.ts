// ─────────────────────────────────────────────────────────────────────────────
// What of a site may reach a client
// docs/cadrage.md § 3.7 — DTOs with listed columns, never a `*`.
// ─────────────────────────────────────────────────────────────────────────────
//
// `sites` carries `wp_app_password` and `github_token`. Every query of the
// client space selects CLIENT_SITE_COLUMNS, and every object sent to a member
// goes through toClientSiteDto, which copies fields by name: a column added to
// the table tomorrow reaches no client until someone writes it here.

export const CLIENT_SITE_COLUMNS = 'id,name,url'

export interface ClientSiteRow {
  id: string
  name: string
  url: string
}

export interface ClientSiteDto {
  id: string
  name: string
  url: string
}

export function toClientSiteDto(row: ClientSiteRow): ClientSiteDto {
  return { id: row.id, name: row.name, url: row.url }
}
