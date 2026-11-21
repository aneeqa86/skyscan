import { GITHUB_URL } from '@/components/layout/Navbar'
import { Svg } from '@/components/ui/kit'

const METHOD_URL = `${GITHUB_URL}/blob/main/docs/METHOD.md`
const SOURCES_URL = `${GITHUB_URL}/blob/main/docs/DATA_SOURCES.md`

const PIPELINE = [
  [
    'Fetch points',
    'Stream only the points inside the drawn area: USGS 3DEP from Entwine Point Tiles, AHN from cached LAZ tiles. Noise and outliers are dropped.',
  ],
  ['Ground filter', 'Use the survey’s ground class, or find the ground with SMRF, then interpolate a bare-earth terrain model.'],
  ['nDSM', 'Subtract the terrain model from the surface model to get height above ground for every 0.5 m cell.'],
  [
    'Separate roofs from trees',
    'Trees let laser pulses through and are rough; roofs are planar. Touching buildings are split where roof heights jump.',
  ],
  ['Vectorize and validate', 'Trace footprints with height, floors and volume, then score them against Overture Maps or OpenStreetMap.'],
  ['Compare surveys', 'For Change, align two surveys on stable ground, difference them and classify each change.'],
  [
    'Cross-check with imagery',
    'Yearly aerial images (NAIP, PDOK) confirm each change, date when it became visible between the surveys, and flag tree crowns by their near-infrared.',
  ],
]

const STACK = [
  ['Interface', ['React', 'Vite', 'Tailwind CSS', 'Mapbox GL JS', 'mapbox-gl-draw', 'deck.gl']],
  ['Processing', ['Python', 'PDAL', 'GDAL', 'rasterio', 'NumPy', 'SciPy', 'scikit-image', 'Shapely', 'Celery']],
  ['API and data', ['Django REST Framework', 'GeoDjango', 'PostgreSQL + PostGIS', 'Redis']],
  ['Formats', ['EPT', 'LAZ', 'GeoJSON', 'MVT', 'CSV']],
]

function Badge({ children }) {
  return <li className="rounded-badge border-hair border-line-strong px-2 py-1 font-mono text-xs text-fg">{children}</li>
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-page px-4 pb-24 pt-14 sm:px-8">
      <div className="flex max-w-[760px] flex-col gap-3">
        <div className="eyebrow">ABOUT</div>
        <h1 className="m-0 font-display text-[clamp(32px,4vw,52px)] font-medium leading-[1.05] tracking-[-0.025em]">
          Reading cities from the air, one rooftop at a time
        </h1>
        <p className="m-0 text-[17px] leading-relaxed text-muted">
          SKYSCAN is a personal portfolio project. It takes free aerial LiDAR from national mapping agencies and turns it into measured
          buildings you can inspect in 2D, in extruded 3D and as the raw point cloud, and it finds what changed between two surveys.
        </p>
      </div>

      <div className="mt-14 flex flex-wrap gap-12">
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-12">
          <section>
            <h2 className="m-0 font-display text-2xl font-medium">Why I built it</h2>
            <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted">
              Governments publish excellent LiDAR for free, but the raw files are hard to look at and harder to trust. Open footprint maps
              have outlines but rarely heights, and they do not say what changed. I wanted a tool that answers plain questions in a minute:
              where are the buildings, how tall and how large are they, which points prove it, and what is new since the last survey.
            </p>
            <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted">
              Showing every result three ways is the point. The footprint map is for analysis, the extruded view is for intuition, and the
              point cloud is for evidence.
            </p>
          </section>

          <section>
            <h2 className="m-0 font-display text-2xl font-medium">The pipeline</h2>
            <ol className="m-0 mt-4 list-none border-t-hair border-line p-0">
              {PIPELINE.map(([title, text], i) => (
                <li key={title} className="flex gap-5 border-b-hair border-line py-4">
                  <span className="w-6 shrink-0 font-mono text-[13px] text-teal">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="m-0 text-[15px] font-medium">{title}</h3>
                    <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <a
              href={METHOD_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 py-3 text-sm text-teal hover:text-teal-hover"
            >
              Full method, accuracy results and limits (METHOD.md)
              <Svg name="arrow" size={14} />
            </a>
          </section>

          <section>
            <h2 className="m-0 font-display text-2xl font-medium">Limits and next steps</h2>
            <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted">
              Detection is height-based. Dense evergreen trees, cranes and parked trains can pass the tests, and in dense city cores the
              reference maps split blocks into one building per lot while LiDAR sees one roof, so footprint scores there are low even when
              heights are right. Heights depend on when a survey was flown, and Change mode compares surveys of different density and
              season.
            </p>
            <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted">
              Next: roof-type classification, an accuracy reference for Change mode, and more national datasets.
            </p>
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5 md:max-w-[360px]">
          <section className="card flex flex-col gap-3 p-5">
            <h2 className="label-mono">Source code</h2>
            <div className="font-mono text-[13px] text-fg">github.com/aneeqa86/skyscan</div>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-primary self-start">
              View on GitHub
              <Svg name="arrow" strokeWidth={1.5} />
            </a>
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="label-mono">Tech stack</h2>
            {STACK.map(([group, items]) => (
              <div key={group}>
                <h3 className="m-0 mb-2 text-[13px] font-medium">{group}</h3>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {items.map((it) => (
                    <Badge key={it}>{it}</Badge>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <h2 className="label-mono">Data attribution</h2>
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              LiDAR: USGS 3D Elevation Program (public domain) and Actueel Hoogtebestand Nederland (CC0), the latter via the GeoTiles mirror
              (TU Delft). Reference footprints: Overture Maps Foundation and © OpenStreetMap contributors (ODbL). Aerial imagery: USDA NAIP
              (public domain) via Microsoft Planetary Computer, and Beeldmateriaal Nederland via PDOK (CC BY 4.0). Basemap © Mapbox.
            </p>
            <a
              href={SOURCES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 py-2 text-[13px] text-teal hover:text-teal-hover"
            >
              All sources and licences (DATA_SOURCES.md)
              <Svg name="arrow" size={14} />
            </a>
          </section>
        </aside>
      </div>
    </div>
  )
}
