import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import HeroScan from '@/components/brand/HeroScan'
import Navbar from '@/components/layout/Navbar'
import { Spinner, Svg } from '@/components/ui/kit'
import { SkyscanService } from '@/services'

const STEPS = [
  {
    n: '01',
    tag: 'ACQUIRE',
    title: 'Acquire',
    text: 'Draw an area of interest. SKYSCAN finds the newest survey that covers it and streams only the points inside it.',
    foot: 'EPT · LAZ',
    art: (
      <svg viewBox="0 0 280 110" className="block h-auto w-full" role="img" aria-label="Tile grid with the area of interest outlined">
        <defs>
          <pattern id="tg" width="40" height="30" patternUnits="userSpaceOnUse">
            <rect x=".25" y=".25" width="39.5" height="29.5" fill="none" stroke="#2A3A57" strokeWidth=".5" />
          </pattern>
        </defs>
        <rect x="0" y="10" width="280" height="90" fill="url(#tg)" />
        <polygon points="48,28 176,22 214,62 150,92 62,80" fill="rgba(0,201,167,.12)" stroke="#00C9A7" strokeWidth=".9" strokeDasharray="4 3" />
        <g fill="#FF6B35">
          {[[48, 28], [176, 22], [214, 62], [150, 92], [62, 80]].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="2.5" />
          ))}
        </g>
      </svg>
    ),
  },
  {
    n: '02',
    tag: 'CLASSIFY',
    title: 'Classify',
    text: 'A ground filter separates terrain from everything above it. Roofs are told apart from trees by how the laser returns behave.',
    foot: 'GROUND · nDSM · ROOF vs TREE',
    art: (
      <svg viewBox="0 0 280 110" className="block h-auto w-full" role="img" aria-label="Cross-section of points classified as ground, vegetation and buildings">
        <defs>
          <pattern id="pg" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#6F7F9C" /></pattern>
          <pattern id="pb" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#00C9A7" /></pattern>
          <pattern id="pv" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#9DBF5A" /></pattern>
        </defs>
        <path d="M0 84 L60 84 L100 78 L160 80 L220 76 L280 78 L280 110 L0 110 Z" fill="url(#pg)" />
        <rect x="64" y="38" width="42" height="46" fill="url(#pb)" />
        <rect x="176" y="22" width="48" height="58" fill="url(#pb)" />
        <circle cx="134" cy="62" r="16" fill="url(#pv)" />
        <circle cx="250" cy="64" r="12" fill="url(#pv)" />
      </svg>
    ),
  },
  {
    n: '03',
    tag: 'EXTRACT',
    title: 'Extract',
    text: 'Footprints are traced with their height, floors and volume, then checked against independent maps. Export them as GeoJSON or CSV.',
    foot: 'POLYGONS · HEIGHT · VALIDATION',
    art: (
      <svg viewBox="0 0 280 110" className="block h-auto w-full" role="img" aria-label="A vectorized building footprint with its height reading">
        <polygon points="70,70 130,40 190,70 130,100" fill="rgba(0,201,167,.12)" stroke="#00C9A7" strokeWidth=".9" />
        <polygon points="70,70 130,100 130,60 70,30" fill="none" stroke="#2A3A57" strokeWidth=".75" />
        <polygon points="130,100 190,70 190,30 130,60" fill="none" stroke="#2A3A57" strokeWidth=".75" />
        <polygon points="70,30 130,0 190,30 130,60" fill="none" stroke="#FF6B35" strokeWidth=".9" />
        <line x1="206" y1="30" x2="206" y2="70" stroke="#FF6B35" strokeWidth=".75" strokeDasharray="3 3" />
        <text x="216" y="54" fontFamily="JetBrains Mono, monospace" fontSize="13" fill="#FF6B35">24.6 m</text>
      </svg>
    ),
  },
  {
    n: '04',
    tag: 'COMPARE',
    title: 'Compare',
    text: 'With two surveys of the same area, SKYSCAN aligns them on stable ground and flags new buildings, demolitions and added floors.',
    foot: 'NEW · DEMOLISHED · RAISED',
    art: (
      <svg viewBox="0 0 280 110" className="block h-auto w-full" role="img" aria-label="Two surveys side by side: a building that is new in the later survey">
        <line x1="140" y1="6" x2="140" y2="104" stroke="#E8EEF6" strokeWidth=".75" />
        <polygon points="40,80 80,60 120,80 80,100" fill="none" stroke="#2A3A57" strokeWidth=".75" />
        <polygon points="40,80 80,60 80,40 40,60" fill="none" stroke="#2A3A57" strokeWidth=".75" />
        <polygon points="80,60 120,80 120,60 80,40" fill="none" stroke="#2A3A57" strokeWidth=".75" />
        <polygon points="160,80 200,60 240,80 200,100" fill="rgba(0,201,167,.12)" stroke="#00C9A7" strokeWidth=".9" />
        <polygon points="160,80 200,60 200,14 160,34" fill="none" stroke="#00C9A7" strokeWidth=".9" />
        <polygon points="200,60 240,80 240,34 200,14" fill="none" stroke="#00C9A7" strokeWidth=".9" />
        <text x="12" y="20" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#8C9BB3">2013</text>
        <text x="248" y="20" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#00C9A7">2020</text>
      </svg>
    ),
  },
]

const AUDIENCES = [
  ['Planners', 'Heights, floors and volume for every building in a district, where open footprint data has no heights.'],
  ['GIS analysts and researchers', 'Footprints measured from raw point clouds, scored against independent maps, exported as GeoJSON or CSV.'],
  ['Assessors and code enforcement', 'New buildings, demolitions, added floors and extensions between two LiDAR surveys.'],
]

const TILES = [
  {
    name: 'New York',
    meta: 'USA · USGS 3DEP · ready',
    to: '/explorer?mode=measure&city=midtown-manhattan',
    art: (
      <g fill="rgba(0,201,167,.14)" stroke="#00C9A7" strokeWidth=".6">
        <rect x="10" y="10" width="38" height="26" /><rect x="60" y="10" width="28" height="52" /><rect x="100" y="10" width="40" height="20" />
        <rect x="152" y="10" width="38" height="40" /><rect x="10" y="48" width="38" height="60" /><rect x="100" y="44" width="40" height="64" />
        <rect x="152" y="64" width="38" height="44" fill="#FF6B35" fillOpacity=".25" stroke="#FF6B35" />
      </g>
    ),
  },
  {
    name: 'Denver',
    meta: 'USA · change 2013 → 2020 · ready',
    to: '/explorer?mode=change&city=denver-union-station',
    art: (
      <>
        <line x1="100" y1="0" x2="100" y2="120" stroke="#E8EEF6" strokeWidth=".6" />
        <g fill="none" stroke="#2A3A57" strokeWidth=".6"><rect x="14" y="16" width="30" height="30" /><rect x="54" y="60" width="34" height="40" /></g>
        <g fill="rgba(0,201,167,.14)" stroke="#00C9A7" strokeWidth=".6"><rect x="114" y="16" width="30" height="30" /><rect x="154" y="18" width="34" height="44" /><rect x="154" y="74" width="34" height="34" /></g>
        <g fill="none" stroke="#2A3A57" strokeWidth=".6"><rect x="114" y="60" width="34" height="40" /></g>
      </>
    ),
  },
  {
    name: 'Amsterdam',
    meta: 'NL · AHN5',
    to: '/explorer?mode=measure&lon=4.8790&lat=52.3378&zoom=15.5',
    art: (
      <>
        <path d="M0 84 Q100 58 200 92" fill="none" stroke="#14203A" strokeWidth="8" />
        <g fill="rgba(0,201,167,.14)" stroke="#00C9A7" strokeWidth=".6">
          <rect x="12" y="12" width="64" height="10" /><rect x="12" y="28" width="64" height="10" /><rect x="12" y="44" width="64" height="10" />
          <rect x="98" y="12" width="10" height="56" /><rect x="114" y="12" width="10" height="56" /><rect x="130" y="12" width="10" height="56" />
          <rect x="152" y="14" width="38" height="30" /><rect x="20" y="96" width="60" height="14" /><rect x="110" y="98" width="70" height="12" />
        </g>
      </>
    ),
  },
  {
    name: 'Seattle',
    meta: 'USA · USGS 3DEP 2021',
    to: '/explorer?mode=measure&lon=-122.3145&lat=47.6250&zoom=16',
    art: (
      <g fill="rgba(0,201,167,.14)" stroke="#00C9A7" strokeWidth=".6">
        {[14, 46, 78, 110, 142, 174].flatMap((x) =>
          [14, 50, 86].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="18" height="22" />)
        )}
      </g>
    ),
  },
  {
    name: 'Chicago',
    meta: 'USA · USGS 3DEP 2017',
    to: '/explorer?mode=measure&lon=-87.6440&lat=41.9200&zoom=16',
    art: (
      <g fill="rgba(0,201,167,.14)" stroke="#00C9A7" strokeWidth=".6">
        {[10, 30, 50, 70, 120, 140, 160, 180].map((x) => (
          <rect key={x} x={x} y="12" width="14" height="40" />
        ))}
        {[10, 30, 50, 70, 120, 140, 160, 180].map((x) => (
          <rect key={`b${x}`} x={x} y="68" width="14" height="40" />
        ))}
      </g>
    ),
  },
]

/** One line of accuracy numbers, only when the showcase validation computed them. */
function AccuracyLine({ cities }) {
  const city = cities?.find((c) => c.showcase_mode === 'measure' && c.showcase_job?.validation)
  if (!city) return null
  const v = city.showcase_job.validation
  return (
    <p className="m-0 font-mono text-xs leading-relaxed text-muted">
      Validated against {v.source === 'osm' ? 'OpenStreetMap' : 'Overture Maps'} in {city.name}: precision{' '}
      <span className="text-fg">{v.precision?.toFixed(2)}</span>, recall <span className="text-fg">{v.recall?.toFixed(2)}</span>, IoU{' '}
      <span className="text-fg">{v.mean_iou?.toFixed(2)}</span>
      {v.height_mae_m != null && (
        <>
          , height error <span className="text-fg">{v.height_mae_m.toFixed(1)} m</span> over {v.height_compared} buildings
        </>
      )}
      .{' '}
      <Link to="/about" className="text-teal hover:text-teal-hover">
        How accuracy is measured
      </Link>
    </p>
  )
}

export default function LandingPage() {
  const [cities, setCities] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    SkyscanService.getCities({ is_showcase: true })
      .then(setCities)
      .catch(() => setError(true))
  }, [])

  return (
    <>
      <section className="grid-texture relative overflow-hidden border-b-hair border-line">
        <Navbar hero />
        <div className="relative mx-auto flex max-w-page flex-wrap items-center gap-12 px-4 pb-20 pt-10 sm:px-8">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-7">
            <div className="eyebrow">OPEN AERIAL LIDAR · USA + NETHERLANDS</div>
            <h1 className="m-0 font-display text-[clamp(40px,5.4vw,76px)] font-medium leading-[1.02] tracking-[-0.03em]">
              Every rooftop has a story.
              <br />
              <span className="text-teal">We read them all.</span>
            </h1>
            <p className="m-0 max-w-[500px] text-[17px] leading-relaxed text-muted">
              SKYSCAN measures every building in an area from free aerial LiDAR, with heights you can check against
              independent maps, and finds what changed between two surveys.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/explorer" className="btn-primary h-12 px-6 text-[15px]">
                Launch explorer
                <Svg name="arrow" strokeWidth={1.5} />
              </Link>
              <Link to="/datasets" className="btn-secondary h-12 bg-transparent px-6 text-[15px]">
                Browse datasets
              </Link>
            </div>
            <dl className="m-0 mt-2 flex flex-wrap gap-x-10 gap-y-5 border-t-hair border-line pt-5">
              {[
                ['VIEWS', '2D · 3D · Point cloud'],
                ['MODES', 'Measure · Change'],
                ['EXPORT', 'GeoJSON · CSV · Screenshot'],
                ['COVERAGE', 'USA + Netherlands'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[11px] tracking-[0.12em] text-muted">{k}</dt>
                  <dd className="m-0 mt-1.5 text-sm">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="min-h-[2.5rem]">
              <AccuracyLine cities={cities} />
            </div>
          </div>
          <div className="min-w-0 flex-[1_1_480px]">
            <HeroScan
              reading="41.2 m"
              hud={['52.3378°N  4.8790°E', 'SCAN 09 / 09 BUILDINGS']}
              footer={['AHN5 · LAZ · EPSG:28992', 'nDSM > 2.5 m']}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-page px-4 pb-6 pt-24 sm:px-8" aria-labelledby="how">
        <div className="mb-10 flex flex-col gap-3">
          <div className="eyebrow">HOW IT WORKS</div>
          <h2 id="how" className="m-0 font-display text-[clamp(28px,3.4vw,44px)] font-medium leading-[1.1] tracking-[-0.02em]">
            From raw points to measured buildings
          </h2>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5">
          {STEPS.map((s) => (
            <article key={s.n} className="card flex flex-col gap-4 p-7">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[13px] text-teal">{s.n}</span>
                <span className="font-mono text-[11px] tracking-[0.12em] text-muted">{s.tag}</span>
              </div>
              {s.art}
              <h3 className="m-0 font-display text-2xl font-medium">{s.title}</h3>
              <p className="m-0 text-[15px] leading-relaxed text-muted">{s.text}</p>
              <div className="mt-auto border-t-hair border-line pt-3.5 font-mono text-xs text-muted">{s.foot}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-page px-4 pt-16 sm:px-8" aria-labelledby="who">
        <h2 id="who" className="label-mono">
          Who it is for
        </h2>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] border-y-hair border-line">
          {AUDIENCES.map(([title, text], i) => (
            <div key={title} className={i > 0 ? 'border-line py-6 md:border-l-hair md:pl-6' : 'py-6 md:pr-6'}>
              <h3 className="m-0 font-display text-lg font-medium">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-page px-4 pb-24 pt-[72px] sm:px-8" aria-labelledby="cities">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="eyebrow">SHOWCASE</div>
            <h2 id="cities" className="m-0 font-display text-[clamp(28px,3.4vw,44px)] font-medium leading-[1.1] tracking-[-0.02em]">
              Start with a city
            </h2>
          </div>
          <Link to="/datasets" className="py-3 text-sm text-teal hover:text-teal-hover">
            All datasets
          </Link>
        </div>
        {error && <p className="mb-4 text-sm text-muted">The showcase summaries could not be loaded. The tiles still open the explorer.</p>}
        {cities === null && !error && <Spinner label="Loading showcases" className="mb-4 text-sm text-muted" />}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
          {TILES.map((t) => (
            <Link key={t.name} to={t.to} className="card flex flex-col overflow-hidden text-fg transition-colors hover:border-teal hover:text-fg">
              <svg viewBox="0 0 200 120" className="block h-auto w-full bg-mapbg" aria-hidden="true">
                {t.art}
              </svg>
              <div className="flex flex-col gap-1 p-4">
                <span className="font-display text-lg font-medium">{t.name}</span>
                <span className="font-mono text-xs text-muted">{t.meta}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t-hair border-line bg-panel">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-8">
          <h2 className="m-0 max-w-[560px] font-display text-[clamp(24px,2.8vw,36px)] font-medium leading-[1.15] tracking-[-0.02em]">
            Pick an area. Watch the rooftops appear.
          </h2>
          <Link to="/explorer" className="btn-primary h-12 px-6 text-[15px]">
            Launch explorer
            <Svg name="arrow" strokeWidth={1.5} />
          </Link>
        </div>
      </section>
    </>
  )
}
