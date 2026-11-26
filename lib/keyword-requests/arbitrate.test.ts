import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./repository', () => ({
  getRequestForArbitration: vi.fn(),
  applyOperatorDecision: vi.fn(),
  listSiteCampaigns: vi.fn(),
  pickSiteCampaign: vi.fn(),
}))

import { arbitrate } from './arbitrate'
import { applyOperatorDecision, getRequestForArbitration, listSiteCampaigns, pickSiteCampaign } from './repository'

const REQUEST = { id: 'r1', site_id: 'site-a', campaign_id: 'camp-1', status: 'review' as const }

beforeEach(() => {
  vi.mocked(getRequestForArbitration).mockReset().mockResolvedValue(REQUEST)
  vi.mocked(applyOperatorDecision).mockReset().mockResolvedValue(true)
  vi.mocked(listSiteCampaigns).mockReset().mockResolvedValue([])
  vi.mocked(pickSiteCampaign).mockReset().mockReturnValue(null)
})

describe('arbitrate', () => {
  it('ecrit la decision de CNX, conditionnee au statut que la console a vu', async () => {
    expect(await arbitrate({ requestId: 'r1', action: 'defer' })).toEqual({ kind: 'done', status: 'deferred', reasonCode: 'OPERATOR_DEFERRED' })
    expect(applyOperatorDecision).toHaveBeenCalledWith('r1', expect.objectContaining({ from: 'review', status: 'deferred' }), null)
  })

  it('une demande inconnue est introuvable ; un geste hors statut ou sans motif est refuse sans rien ecrire', async () => {
    vi.mocked(getRequestForArbitration).mockResolvedValueOnce(null)
    expect(await arbitrate({ requestId: 'x', action: 'defer' })).toEqual({ kind: 'not_found' })

    expect(await arbitrate({ requestId: 'r1', action: 'decline', reason: 'non' })).toEqual({ kind: 'problem', problem: 'reason_required' })
    expect(await arbitrate({ requestId: 'r1', action: 'reopen' })).toEqual({ kind: 'problem', problem: 'not_allowed' })
    expect(applyOperatorDecision).not.toHaveBeenCalled()
  })

  it('une demande deplacee entre l ecran et le clic : la console recharge', async () => {
    vi.mocked(applyOperatorDecision).mockResolvedValueOnce(false)
    expect(await arbitrate({ requestId: 'r1', action: 'integrate' })).toEqual({ kind: 'changed' })
  })

  it('une demande sans campagne en recoit une pour rejoindre la file, ou le geste est refuse', async () => {
    vi.mocked(getRequestForArbitration).mockResolvedValue({ ...REQUEST, campaign_id: null })
    expect(await arbitrate({ requestId: 'r1', action: 'integrate' })).toEqual({ kind: 'problem', problem: 'no_campaign' })

    vi.mocked(pickSiteCampaign).mockReturnValue({ id: 'camp-2' } as ReturnType<typeof pickSiteCampaign>)
    expect(await arbitrate({ requestId: 'r1', action: 'integrate' })).toMatchObject({ kind: 'done' })
    expect(applyOperatorDecision).toHaveBeenLastCalledWith('r1', expect.objectContaining({ reason_code: 'OPERATOR_INTEGRATE' }), 'camp-2')

    // Refuser ne remet dans aucune file : pas de campagne a chercher.
    expect(await arbitrate({ requestId: 'r1', action: 'decline', reason: 'Ce service n’est pas proposé.' })).toMatchObject({ kind: 'done', status: 'declined' })
    expect(applyOperatorDecision).toHaveBeenLastCalledWith('r1', expect.anything(), null)
  })
})
