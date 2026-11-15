import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import Logo from '@/components/brand/Logo'
import { cn } from '@/utils'

export const GITHUB_URL = 'https://github.com/aneeqa86/skyscan'

const NAV_LINKS = [
  { to: '/explore?mode=measure', label: 'Measure', match: 'measure' },
  { to: '/explore?mode=change', label: 'Change', match: 'change' },
  { to: '/about', label: 'About & data' },
]

export default function Navbar({ compact = false }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const linkClass = ({ isActive }) =>
    cn(
      'rounded px-3 py-1.5 text-sm transition-colors',
      isActive ? 'text-teal' : 'text-muted hover:text-fg'
    )

  return (
    <header className={cn('z-40 border-b bg-ink-900/90 backdrop-blur', !compact && 'sticky top-0')}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6" aria-label="Main">
        <Link to="/" aria-label="SKYSCAN home" className="rounded">
          <Logo size="sm" />
        </Link>

        <ul className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map(({ to, label }) => (
            <li key={label}>
              <NavLink to={to} className={linkClass}>
                {label}
              </NavLink>
            </li>
          ))}
          <li>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="ml-2 btn-secondary py-1.5 text-xs">
              GitHub
            </a>
          </li>
        </ul>

        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded p-2 text-muted hover:text-fg sm:hidden"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            {menuOpen ? <path d="M6 18L18 6M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </nav>

      {menuOpen && (
        <ul className="flex flex-col gap-1 border-t px-4 py-3 sm:hidden">
          {NAV_LINKS.map(({ to, label }) => (
            <li key={label}>
              <NavLink to={to} onClick={() => setMenuOpen(false)} className={linkClass}>
                {label}
              </NavLink>
            </li>
          ))}
          <li>
            <a href={GITHUB_URL} className="block px-3 py-1.5 text-sm text-muted" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </li>
        </ul>
      )}
    </header>
  )
}
