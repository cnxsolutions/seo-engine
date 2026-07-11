import { initScheduler } from '@/lib/scheduler/cron'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initScheduler()
  }
}
