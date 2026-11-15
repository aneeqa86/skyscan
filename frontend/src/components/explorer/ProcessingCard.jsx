/**
 * Processing card (Explorer-Processing.dc.html), driven by the job's real
 * progress: stages, the active stage's percent and detail, elapsed and ETA.
 */
import { useEffect, useState } from 'react'
import { ProgressStepper } from '@/components/ui/kit'

// Progress ranges reported by the backend pipeline for each stage.
const STAGES = {
  measure: [
    ['Fetch points', 0, 25, 'Stream the area from the survey'],
    ['Ground filter', 25, 40, 'Survey class 2, or SMRF'],
    ['nDSM', 40, 60, 'DSM − DTM · 0.5 m grid'],
    ['Roofs vs trees', 60, 75, 'Returns, depth, roughness'],
    ['Vectorize', 75, 92, 'Footprints, height, volume'],
    ['Validate', 92, 100, 'Compare with Overture / OSM'],
  ],
  change: [
    ['Earlier survey', 0, 28, 'Fetch and measure'],
    ['Later survey', 28, 60, 'Fetch and measure'],
    ['Align surveys', 60, 70, 'Median offset on stable ground'],
    ['Classify changes', 70, 85, 'New, demolished, raised…'],
    ['Pack results', 85, 100, 'Point clouds and footprints'],
  ],
}

export function stepsFor(job, mode) {
  const p = job?.progress ?? 0
  return STAGES[mode].map(([label, start, end, hint]) => {
    const state = p >= end ? 'done' : p >= start ? 'active' : 'queued'
    const percent = state === 'active' ? Math.round(((p - start) / (end - start)) * 100) : undefined
    return { label, state, percent, detail: state === 'active' && job?.stage_message ? job.stage_message : hint }
  })
}

function mmss(sec) {
  const s = Math.max(0, Math.round(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function ProcessingCard({ job, mode }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const elapsed = job?.created_at ? (now - new Date(job.created_at).getTime()) / 1000 : 0
  const p = job?.progress ?? 0
  const eta = p >= 8 ? (elapsed * (100 - p)) / p : null
  return (
    <section aria-label="Processing pipeline" role="status" aria-live="polite" className="floating w-[min(380px,calc(100vw-32px))] p-4">
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-lg font-medium">{mode === 'change' ? 'Comparing surveys' : 'Detecting buildings'}</h2>
        <span className="font-mono text-xl text-orange">{p}%</span>
      </header>
      <div className="mb-2.5 flex justify-between font-mono text-xs text-muted">
        <span>Elapsed {mmss(elapsed)}</span>
        <span>{eta != null ? `ETA ~${mmss(eta)}` : 'ETA after the first stage'}</span>
      </div>
      <div className="mb-3.5 h-0.5 bg-line">
        <div className="h-0.5 bg-orange transition-all duration-700" style={{ width: `${p}%` }} />
      </div>
      <ProgressStepper steps={stepsFor(job, mode)} />
    </section>
  )
}
