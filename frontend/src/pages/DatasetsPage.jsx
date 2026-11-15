import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, Segmented, Svg } from '@/components/ui/kit'
import { DATASETS } from '@/data/datasets'

function CoverageMap({ dataset }) {
  return (
    <div className="relative h-40 border-b-hair border-line bg-mapbg">
      <svg
        viewBox="0 0 200 120"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Coverage: ${dataset.coverage}`}
      >
        <defs>
          <pattern id={`dg-${dataset.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#111B30" strokeWidth=".5" />
          </pattern>
        </defs>
        <rect width="200" height="120" fill={`url(#dg-${dataset.id})`} />
        {dataset.shape.map((pts) => (
          <polygon key={pts} points={pts} fill="rgba(0,201,167,.12)" stroke="#00C9A7" strokeWidth=".7" strokeDasharray="3 2" />
        ))}
      </svg>
      <span className="chip absolute left-3 top-3">
        {dataset.region === 'USA' ? 'USA' : `EUROPE · ${dataset.country}`}
      </span>
    </div>
  )
}

function DatasetCard({ d }) {
  const fields = [
    ['ACQUISITION', d.acquisition, true],
    ['POINT DENSITY', d.density, true, 'orange'],
    ['LICENSE', d.license],
    ['COVERAGE', d.coverage],
  ]
  return (
    <article className="card flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      <CoverageMap dataset={d} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h2 className="m-0 font-display text-[22px] font-medium">{d.name}</h2>
          <p className="mt-1 text-[13px] text-muted">{d.agency}</p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3.5">
          {fields.map(([k, v, mono, tone]) => (
            <div key={k}>
              <dt className="dt-mono">{k}</dt>
              <dd className={`m-0 mt-1 text-[13px] ${mono ? 'font-mono' : ''} ${tone === 'orange' ? 'text-orange' : ''}`}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-auto flex items-center justify-between gap-3 border-t-hair border-line pt-4">
          <span className="inline-flex items-center gap-2 font-mono text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${d.inExplorer ? 'bg-teal' : 'bg-disabled'}`} />
            {d.format}
          </span>
          {d.inExplorer ? (
            <Link to={d.explorer} className="btn-secondary bg-transparent">
              Open in explorer
            </Link>
          ) : (
            <a href={d.url} target="_blank" rel="noreferrer" className="btn-ghost px-0 text-[13px]">
              Agency page
              <Svg name="arrow" size={14} />
            </a>
          )}
        </div>
        {!d.inExplorer && <p className="m-0 -mt-2 text-xs text-muted">Listed for reference. SKYSCAN has no adapter for it yet.</p>}
      </div>
    </article>
  )
}

export default function DatasetsPage() {
  const [region, setRegion] = useState('all')
  const [q, setQ] = useState('')
  const counts = {
    all: DATASETS.length,
    USA: DATASETS.filter((d) => d.region === 'USA').length,
    Europe: DATASETS.filter((d) => d.region === 'Europe').length,
  }
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return DATASETS.filter(
      (d) =>
        (region === 'all' || d.region === region) &&
        (!needle || `${d.name} ${d.agency} ${d.country}`.toLowerCase().includes(needle))
    )
  }, [region, q])

  return (
    <div className="mx-auto max-w-page px-4 pb-24 pt-14 sm:px-8">
      <div className="flex max-w-[640px] flex-col gap-3">
        <div className="eyebrow">DATASETS</div>
        <h1 className="m-0 font-display text-[clamp(32px,4vw,52px)] font-medium leading-[1.05] tracking-[-0.025em]">
          Free LiDAR, ready to scan
        </h1>
        <p className="m-0 text-base leading-relaxed text-muted">
          Every source below is published openly by a national or federal mapping agency. Two of them run in the
          explorer today: pick an area and SKYSCAN reads only the points inside it.
        </p>
      </div>

      <div className="mb-6 mt-10 flex flex-wrap items-center justify-between gap-4 border-y-hair border-line py-4">
        <Segmented
          label="Region"
          value={region}
          onChange={setRegion}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'USA', label: 'USA', count: counts.USA },
            { value: 'Europe', label: 'Europe', count: counts.Europe },
          ]}
        />
        <label className="flex h-target w-[min(320px,100%)] items-center gap-2.5 rounded-control border-hair border-line-strong bg-panel px-3.5 text-muted focus-within:border-teal">
          <Svg name="search" />
          <span className="sr-only">Search datasets</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or agency"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-fg placeholder-muted outline-none"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="results" title="No datasets match" action={
          <button type="button" className="btn-secondary" onClick={() => { setQ(''); setRegion('all') }}>
            Clear search
          </button>
        }>
          Nothing matches “{q}”. Try an agency or a country.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-5">
          {shown.map((d) => (
            <DatasetCard key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  )
}
