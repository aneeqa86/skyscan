import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import IsoCity from '@/components/brand/IsoCity'
import { Spinner } from '@/components/ui'
import { SkyscanService } from '@/services'
import { formatNumber } from '@/utils'

const HERO_BLOCKS = [
  { x: 0, y: 0, w: 3, d: 3, h: 6 },
  { x: 4, y: 0, w: 2, d: 3, h: 11 },
  { x: 7, y: 0, w: 3, d: 2, h: 4 },
  { x: 0, y: 4, w: 3, d: 2, h: 3 },
  { x: 4, y: 4, w: 3, d: 3, h: 15 },
  { x: 8, y: 3, w: 2, d: 4, h: 7 },
  { x: 0, y: 7, w: 2, d: 3, h: 5 },
  { x: 3, y: 8, w: 4, d: 2, h: 4 },
  { x: 8, y: 8, w: 2, d: 2, h: 9 },
]

const AUDIENCES = [
  {
    title: 'Planners',
    text: 'Heights, floors and volume for every building in a district, where open footprint data has gaps.',
  },
  {
    title: 'GIS analysts and researchers',
    text: 'Footprints measured from raw point clouds, with accuracy you can check and data you can export.',
  },
  {
    title: 'Assessors and code enforcement',
    text: 'New buildings, demolitions, added floors and extensions between two LiDAR surveys.',
  },
]

const STEPS = [
  { n: '01', title: 'Draw an area', text: 'Up to 1 km² anywhere the LiDAR coverage layer reaches.' },
  {
    n: '02',
    title: 'We read the raw LiDAR',
    text: 'Points stream from USGS 3DEP, the ground is found, and roofs are separated from trees.',
  },
  {
    n: '03',
    title: 'Measured buildings, checked',
    text: 'Footprints with height, floors and volume, scored against independent maps. Compare two surveys to find change.',
  },
]

function ShowcaseCard({ city }) {
  const job = city.showcase_job
  const mode = city.showcase_mode
  return (
    <Link
      to={`/explore?mode=${mode}&city=${city.slug}`}
      className="card group flex flex-col gap-3 transition-colors hover:border-teal"
    >
      <div className="flex items-center justify-between">
        <span className="label">{mode === 'change' ? 'Change showcase' : 'Measure showcase'}</span>
        <span className="chip border-line text-muted">{city.country}</span>
      </div>
      <h3 className="text-lg font-semibold text-fg group-hover:text-teal">{city.name}</h3>
      <p className="text-sm text-muted">{city.blurb}</p>
      {job?.summary && mode === 'measure' && (
        <dl className="mt-auto grid grid-cols-3 gap-3 border-t pt-3">
          <Stat label="Buildings" value={formatNumber(job.summary.building_count)} />
          <Stat label="Median height" value={`${job.summary.median_height_m ?? '-'} m`} />
          <Stat label="Volume" value={`${formatNumber((job.summary.total_volume_m3 ?? 0) / 1e6, 2)} M m³`} />
        </dl>
      )}
      {job?.summary && mode === 'change' && (
        <dl className="mt-auto grid grid-cols-3 gap-3 border-t pt-3">
          <Stat label="Surveys" value={job.summary.years?.join(' → ')} />
          <Stat label="New" value={job.summary.counts?.new ?? 0} tone="teal" />
          <Stat label="Demolished" value={job.summary.counts?.demolished ?? 0} tone="orange" />
        </dl>
      )}
      <span className="text-sm text-teal">Open instantly →</span>
    </Link>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`num mt-1 text-sm ${tone === 'teal' ? 'text-teal' : tone === 'orange' ? 'text-orange' : 'text-fg'}`}>
        {value}
      </dd>
    </div>
  )
}

/** One line of accuracy numbers, only if the showcase validation actually computed them. */
function AccuracyLine({ cities }) {
  const measure = cities.find((c) => c.showcase_mode === 'measure' && c.showcase_job?.validation)
  if (!measure) return null
  const v = measure.showcase_job.validation
  return (
    <p className="num text-xs text-muted">
      Checked against {v.source === 'osm' ? 'OpenStreetMap' : 'Overture Maps'} footprints in {measure.name}:{' '}
      <span className="text-fg">precision {v.precision?.toFixed(2)}</span> ·{' '}
      <span className="text-fg">recall {v.recall?.toFixed(2)}</span> ·{' '}
      <span className="text-fg">IoU {v.mean_iou?.toFixed(2)}</span>
      {v.height_mae_m != null && (
        <>
          {' '}· <span className="text-fg">height error {v.height_mae_m.toFixed(1)} m</span> over {v.height_compared}{' '}
          buildings
        </>
      )}
      .{' '}
      <Link to="/about" className="text-teal hover:underline">
        How we measure
      </Link>
    </p>
  )
}

export default function LandingPage() {
  const [cities, setCities] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    SkyscanService.getCities({ is_showcase: true })
      .then(setCities)
      .catch(() => setError('Showcases could not be loaded. Is the API running?'))
  }, [])

  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="label text-orange">Urban LiDAR intelligence</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-fg sm:text-5xl">
              Every rooftop has a story.
              <br />
              <span className="text-teal">We read them all.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Measured building heights and change detection for any area, from raw LiDAR.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/explore?mode=measure" className="btn-primary px-5 py-2.5">
                Measure buildings
              </Link>
              <Link to="/explore?mode=change" className="btn-secondary px-5 py-2.5">
                Detect change
              </Link>
            </div>
            <div className="mt-8 min-h-[1.5rem]">{cities && <AccuracyLine cities={cities} />}</div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <IsoCity blocks={HERO_BLOCKS} unit={20} className="h-auto max-w-full" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="who">
        <h2 id="who" className="label">Who it is for</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="card">
              <h3 className="font-semibold text-fg">{a.title}</h3>
              <p className="mt-2 text-sm text-muted">{a.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-ink-850" aria-labelledby="how">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 id="how" className="label">How it works</h2>
          <ol className="mt-6 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="border-l pl-5">
                <span className="num text-sm text-orange">{s.n}</span>
                <h3 className="mt-2 font-semibold text-fg">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="showcases">
        <h2 id="showcases" className="label">Showcases, precomputed so they open instantly</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {cities === null && !error && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner size="sm" /> Loading showcases
            </div>
          )}
          {error && <p className="text-sm text-orange">{error}</p>}
          {cities?.length === 0 && (
            <p className="text-sm text-muted">
              No showcases yet. Run <code className="num text-fg">precompute_city</code> and{' '}
              <code className="num text-fg">precompute_change</code> on the backend.
            </p>
          )}
          {cities?.map((c) => <ShowcaseCard key={c.slug} city={c} />)}
        </div>
      </section>
    </>
  )
}
