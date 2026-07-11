import type { Campaign, PageType, ScheduleFrequency, EditorialSlot } from '@/lib/types'
import { createServiceClient } from '@/lib/supabase'

const FREQUENCY_DAYS: Record<ScheduleFrequency, number> = {
  manual: 0,
  daily: 1,
  every_2_days: 2,
  every_3_days: 3,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  custom: 0,
}

export interface GenerateCalendarOptions {
  campaign: Campaign
  startDate?: Date
  slotCount?: number
}

export function generateEditorialCalendar(opts: GenerateCalendarOptions): Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[] {
  const { campaign, startDate = new Date(), slotCount = 30 } = opts
  const frequency = campaign.schedule_frequency || 'daily'
  const intervalDays = FREQUENCY_DAYS[frequency] || 1
  const pageTypes: PageType[] = campaign.page_types && campaign.page_types.length > 0 ? campaign.page_types : ['pillar', 'child']
  const keywords = campaign.keywords?.length > 0 ? campaign.keywords : [campaign.business_type]
  const communes = campaign.communes?.length > 0 ? campaign.communes : [campaign.department || 'Aube']

  if (frequency === 'manual' || intervalDays === 0) return []

  const slots: Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[] = []
  const currentDate = new Date(startDate)
  currentDate.setHours(0, 0, 0, 0)

  const pageTypeRotation = buildPageTypeRotation(pageTypes)
  let keywordIndex = 0
  let communeIndex = 0

  for (let i = 0; i < slotCount; i++) {
    if (frequency === 'custom' && campaign.schedule_days?.length) {
      const dayOfWeek = currentDate.getDay()
      if (!campaign.schedule_days.includes(dayOfWeek)) {
        currentDate.setDate(currentDate.getDate() + 1)
        i--
        if (currentDate.getTime() - startDate.getTime() > 365 * 24 * 60 * 60 * 1000) break
        continue
      }
    }

    const pageType = pageTypeRotation[i % pageTypeRotation.length]
    const keyword = keywords[keywordIndex % keywords.length]
    const city = communes[communeIndex % communes.length]

    slots.push({
      campaign_id: campaign.id,
      scheduled_date: formatDate(currentDate),
      page_type: pageType,
      target_keyword: keyword,
      target_city: city,
      status: 'planned',
    })

    keywordIndex++
    if (keywordIndex % keywords.length === 0) communeIndex++

    if (frequency !== 'custom') {
      currentDate.setDate(currentDate.getDate() + intervalDays)
    } else {
      currentDate.setDate(currentDate.getDate() + 1)
    }
  }

  return slots
}

function buildPageTypeRotation(pageTypes: PageType[]): PageType[] {
  if (pageTypes.length === 1) return pageTypes

  const rotation: PageType[] = []
  const hasPillar = pageTypes.includes('pillar')
  const childTypes = pageTypes.filter((t) => t !== 'pillar')

  if (hasPillar && childTypes.length > 0) {
    rotation.push('pillar')
    for (let i = 0; i < 3; i++) {
      rotation.push(childTypes[i % childTypes.length])
    }
    for (const childType of childTypes.slice(1)) {
      rotation.push(childType)
    }
  } else {
    rotation.push(...pageTypes)
  }

  return rotation
}

export function computeNextRunAt(campaign: Campaign): string | null {
  const frequency = campaign.schedule_frequency || 'daily'
  if (frequency === 'manual') return null

  const intervalDays = FREQUENCY_DAYS[frequency]
  const now = new Date()

  if (frequency === 'custom' && campaign.schedule_days?.length) {
    const targetDay = findNextScheduledDay(now, campaign.schedule_days)
    const [hours, minutes] = (campaign.schedule_time || '09:00').split(':').map(Number)
    targetDay.setHours(hours, minutes, 0, 0)
    if (targetDay <= now) targetDay.setDate(targetDay.getDate() + 7)
    return targetDay.toISOString()
  }

  const next = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000)
  if (campaign.schedule_time) {
    const [hours, minutes] = campaign.schedule_time.split(':').map(Number)
    next.setHours(hours, minutes, 0, 0)
  }
  return next.toISOString()
}

function findNextScheduledDay(from: Date, days: number[]): Date {
  const currentDay = from.getDay()
  const sortedDays = [...days].sort((a, b) => a - b)
  const nextDay = sortedDays.find((d) => d > currentDay)
  const targetDayOfWeek = nextDay ?? sortedDays[0]
  const daysUntil = (targetDayOfWeek - currentDay + 7) % 7 || 7
  const result = new Date(from)
  result.setDate(result.getDate() + daysUntil)
  return result
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export async function saveEditorialSlots(slots: Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[]) {
  if (slots.length === 0) return []
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('editorial_calendar')
    .insert(slots)
    .select('*')

  if (error) throw new Error(error.message)
  return data as EditorialSlot[]
}

export async function listEditorialSlots(campaignId?: string, fromDate?: string, toDate?: string) {
  const supabase = createServiceClient()
  let query = supabase.from('editorial_calendar').select('*, campaign:campaigns(*, site:sites(*))')

  if (campaignId) query = query.eq('campaign_id', campaignId)
  if (fromDate) query = query.gte('scheduled_date', fromDate)
  if (toDate) query = query.lte('scheduled_date', toDate)

  const { data, error } = await query.order('scheduled_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data as EditorialSlot[]
}

export async function updateEditorialSlot(id: string, values: Partial<EditorialSlot>) {
  const supabase = createServiceClient()
  const { error } = await supabase.from('editorial_calendar').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteEditorialSlots(campaignId: string) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('editorial_calendar')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('status', 'planned')
  if (error) throw new Error(error.message)
}
