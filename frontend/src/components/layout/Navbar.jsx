import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import Logo from '@/components/brand/Logo'
import { Svg } from '@/components/ui/kit'
import { cn } from '@/utils'

export const GITHUB_URL = 'https://github.com/aneeqa86/skyscan'

const LINKS = [
  { to: '/explorer', label: 'Explorer' },
  { to: '/datasets', label: 'Datasets' },
  { to: '/about', label: 'About' },
]

/**
 * Marketing header (Landing, Datasets, About). `hero` renders it transparent
 * over the hero grid with the logo subline; otherwise it is a panel bar.
 */
export default function Navbar({ hero = false }) {
  const [open, setOpen] = useState(false)
  const linkClass = ({ isActive }) =>
    cn(
      'border-b py-3 text-sm',
      isActive ? 'border-teal text-teal hover:text-teal' : 'border-transparent text-muted hover:text-fg'
    )
  return (
    <header className={cn(hero ? 'relative' : 'border-b-hair border-line bg-panel')}>
      <div
        className={cn(
          'mx-auto flex max-w-page flex-wrap items-center justify-between gap-4',
          hero ? 'px-4 py-5 sm:px-8' : 'px-4 py-2.5 sm:px-8'
        )}
      >
        <Link to="/" aria-label="SKYSCAN home" className="flex items-center">
          <Logo size={hero ? 'lg' : 'sm'} subline={hero} />
        </Link>
        <nav aria-label="Main" className="hidden flex-wrap items-center gap-x-7 sm:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="py-3 text-sm">
            GitHub
          </a>
          {hero && (
            <Link to="/explorer" className="btn-primary px-[18px]">
              Launch explorer
            </Link>
          )}
        </nav>
        <button
          type="button"
          className="btn-icon sm:hidden"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Svg name={open ? 'close' : 'menu'} />
        </button>
      </div>
      {open && (
        <nav aria-label="Main" className="flex flex-col border-t-hair border-line px-4 pb-3 sm:hidden">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass} onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="py-3 text-sm">
            GitHub
          </a>
        </nav>
      )}
    </header>
  )
}
