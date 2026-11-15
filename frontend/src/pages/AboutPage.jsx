import { GITHUB_URL } from '@/components/layout/Navbar'

const METHOD_URL = `${GITHUB_URL}/blob/main/docs/METHOD.md`
const SOURCES_URL = `${GITHUB_URL}/blob/main/docs/DATA_SOURCES.md`

const SOURCES = [
  {
    name: 'USGS 3D Elevation Program (3DEP)',
    use: 'Point clouds for Measure and Change (Entwine Point Tiles on AWS Open Data)',
    license: 'Public domain (U.S. Government work)',
    attribution: 'USGS 3D Elevation Program',
  },
  {
    name: 'Actueel Hoogtebestand Nederland (AHN2-AHN5)',
    use: 'Point clouds for the Netherlands, including repeat surveys for Change (LAZ tiles via the GeoTiles mirror, TU Delft)',
    license: 'CC0 1.0 (public domain)',
    attribution: 'Actueel Hoogtebestand Nederland (AHN)',
  },
  {
    name: 'Overture Maps, buildings theme',
    use: 'Reference footprints for validation',
    license: 'ODbL',
    attribution: 'Overture Maps Foundation, © OpenStreetMap contributors',
  },
  {
    name: 'OpenStreetMap',
    use: 'Fallback reference footprints and heights',
    license: 'ODbL',
    attribution: '© OpenStreetMap contributors',
  },
  {
    name: 'Mapbox',
    use: 'Basemap and map rendering',
    license: 'Mapbox Terms of Service',
    attribution: '© Mapbox',
  },
]

const STACK = [
  ['Frontend', 'React, Vite, Tailwind CSS, Mapbox GL JS, mapbox-gl-draw, deck.gl, Recharts'],
  ['API', 'Django, Django REST Framework, GeoDjango, drf-spectacular'],
  ['Database', 'PostgreSQL with PostGIS (vector tiles with ST_AsMVT)'],
  ['Jobs', 'Celery and Redis'],
  ['Processing', 'PDAL, GDAL, rasterio, NumPy, SciPy, scikit-image, Shapely, pyproj'],
]

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <p className="label text-orange">About</p>
      <h1 className="mt-3 text-3xl font-semibold text-fg">Building heights and change, straight from LiDAR</h1>
      <p className="mt-4 text-muted">
        Open building footprint maps are good at outlines but patchy on heights, and they rarely say what changed.
        Airborne LiDAR measures every roof directly. SKYSCAN turns those raw point clouds into measured buildings:
        footprints with height, floors and volume, checked against independent maps, and compares two surveys to find
        new buildings, demolitions, added floors and extensions.
      </p>

      <h2 className="label mt-12">The method in brief</h2>
      <ol className="mt-4 space-y-3 text-sm text-muted">
        <li>
          <span className="text-fg">Read.</span> Points stream from the newest survey covering your area, cropped to
          it. Noise and outliers are removed and the ground is found.
        </li>
        <li>
          <span className="text-fg">Model.</span> A terrain model and a surface model give the height of everything
          above the ground on a 0.5 m grid.
        </li>
        <li>
          <span className="text-fg">Separate.</span> Roofs are told apart from trees by how the laser returns behave:
          trees let pulses through and are rough, roofs are planar. Touching buildings are split where roof heights
          jump.
        </li>
        <li>
          <span className="text-fg">Measure and check.</span> Each footprint gets its 90th-percentile height, floors
          and volume, and the result is scored against Overture Maps or OpenStreetMap footprints.
        </li>
        <li>
          <span className="text-fg">Compare.</span> For change, two surveys are aligned on stable ground, differenced
          and every change is classified.
        </li>
      </ol>
      <p className="mt-4 text-sm">
        <a href={METHOD_URL} className="text-teal hover:underline" target="_blank" rel="noreferrer">
          Read the full method, accuracy results and limits (METHOD.md)
        </a>
      </p>

      <h2 className="label mt-12">Data sources and attribution</h2>
      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-800 text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Used for</th>
              <th className="px-4 py-2 font-medium">License</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name} className="border-t">
                <td className="px-4 py-3 text-fg">
                  {s.name}
                  <div className="text-xs text-muted">{s.attribution}</div>
                </td>
                <td className="px-4 py-3 text-muted">{s.use}</td>
                <td className="px-4 py-3 text-muted">{s.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm">
        <a href={SOURCES_URL} className="text-teal hover:underline" target="_blank" rel="noreferrer">
          All sources, including European LiDAR portals (DATA_SOURCES.md)
        </a>
      </p>

      <h2 className="label mt-12">Tech stack</h2>
      <dl className="mt-4 divide-y rounded-lg border">
        {STACK.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-muted">{k}</dt>
            <dd className="text-fg">{v}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-12 text-sm text-muted">
        SKYSCAN is a personal project by Aneeqa. Source code on{' '}
        <a href={GITHUB_URL} className="text-teal hover:underline" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
    </div>
  )
}
