import { Link } from 'react-router-dom'
import { GITHUB_URL } from './Navbar'

export default function Footer() {
  return (
    <footer className="border-t-hair border-line">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-4 py-7 text-[13px] text-muted sm:px-8">
        <span>
          A personal portfolio project by Aneeqa. Built on open government LiDAR: USGS 3DEP and AHN (public domain).
        </span>
        <span className="flex flex-wrap gap-x-6">
          <Link to="/datasets" className="py-3">
            Datasets
          </Link>
          <Link to="/about" className="py-3">
            About
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="py-3">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  )
}
