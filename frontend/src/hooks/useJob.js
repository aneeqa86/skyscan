import { useEffect, useRef, useState } from 'react'
import { SkyscanService } from '@/services'
import { getErrorMessage } from '@/utils'

export const TERMINAL = ['done', 'failed']
const POLL_MS = 1500

/**
 * Poll a job until it is done or failed.
 * Returns { job, error } and keeps polling through transient network errors.
 */
export function useJob(jobId) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    setJob(null)
    setError(null)
    if (!jobId) return undefined
    let cancelled = false
    let failures = 0

    const tick = async () => {
      try {
        const j = await SkyscanService.getJob(jobId)
        if (cancelled) return
        failures = 0
        setError(null)
        setJob(j)
        if (!TERMINAL.includes(j.status)) timer.current = setTimeout(tick, POLL_MS)
      } catch (err) {
        if (cancelled) return
        failures += 1
        if (err?.response?.status === 404 || failures >= 5) {
          setError(getErrorMessage(err))
        } else {
          timer.current = setTimeout(tick, POLL_MS * 2)
        }
      }
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer.current)
    }
  }, [jobId])

  return { job, error }
}
