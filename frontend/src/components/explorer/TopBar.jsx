import { Link } from 'react-router-dom'
import Logo from '@/components/brand/Logo'
import { ExportMenu, PointsIcon, Segmented, Svg } from '@/components/ui/kit'

/**
 * Explorer top bar (Explorer.dc.html): logo, mode switch, view switcher and
 * Export. Views and Export are disabled while a job is processing.
 */
export default function TopBar({ mode, onMode, view, onView, locked, pointsAvailable, exportItems }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-hair border-line bg-panel px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to="/" aria-label="SKYSCAN home" className="flex items-center">
          <Logo />
        </Link>
        <Segmented
          label="Mode"
          value={mode}
          onChange={onMode}
          disabled={locked}
          options={[
            { value: 'measure', label: 'Measure' },
            { value: 'change', label: 'Change' },
          ]}
        />
      </div>
      <Segmented
        label="View"
        value={view}
        onChange={onView}
        options={[
          { value: '2d', label: '2D Map', icon: <Svg name="map" />, disabled: locked },
          { value: '3d', label: '3D Buildings', icon: <Svg name="cube" />, disabled: locked },
          {
            value: 'points',
            label: 'Point Cloud',
            icon: <PointsIcon />,
            disabled: locked || (!pointsAvailable && 'Run or load a job to see its point cloud'),
          },
        ]}
      />
      <ExportMenu items={exportItems} disabled={locked || !exportItems.length} />
    </header>
  )
}
