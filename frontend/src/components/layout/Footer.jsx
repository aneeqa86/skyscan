import { Link } from 'react-router-dom'
import { GITHUB_URL } from './Navbar'

export default function Footer() {
  return (
    <footer className="border-t py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          SKYSCAN is a personal project by Aneeqa. LiDAR: USGS 3D Elevation Program (public domain). Reference
          footprints: Overture Maps, © OpenStreetMap contributors (ODbL). Basemap © Mapbox.
        </p>
        <nav className="flex shrink-0 gap-5" aria-label="Footer">
          <Link to="/explore" className="hover:text-fg">Explorer</Link>
          <Link to="/about" className="hover:text-fg">About & data</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-fg">GitHub</a>
        </nav>
      </div>
    </footer>
  )
}
