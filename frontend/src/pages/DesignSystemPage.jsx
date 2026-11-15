/** Development-only component gallery (mirrors the package's DesignSystem.dc.html). */
import { useState } from 'react'
import Logo, { LogoMark } from '@/components/brand/Logo'
import {
  EmptyState,
  ExportMenu,
  HeightHistogram,
  KeyValues,
  ProgressStepper,
  Segmented,
  SkeletonLines,
  Slider,
  Spinner,
  StatCard,
  SwitchRow,
} from '@/components/ui/kit'

const COLORS = [
  ['void', '#070B14'], ['panel', '#0B1220'], ['raised', '#101A2C'], ['line', '#1C2940'], ['line-strong', '#2A3A57'],
  ['text', '#E8EEF6'], ['muted', '#8C9BB3'], ['disabled', '#5E6E87'], ['teal', '#00C9A7'], ['teal-hover', '#19D9B8'],
  ['orange', '#FF6B35'], ['ground', '#6F7F9C'], ['vegetation', '#9DBF5A'],
  ['h0', '#2B4C7E'], ['h1', '#2A8FA8'], ['h2', '#00C9A7'], ['h3', '#E8B45C'], ['h4', '#FF6B35'],
]

function Spec({ title, children, className = '' }) {
  return (
    <div className={`card p-6 ${className}`}>
      <div className="label-mono mb-4">{title}</div>
      {children}
    </div>
  )
}

export default function DesignSystemPage() {
  const [view, setView] = useState('2d')
  const [layers, setLayers] = useState({ a: true, b: false })
  const [h, setH] = useState(3)
  const heights = [3, 4, 6, 8, 9, 11, 12, 12, 13, 14, 14, 15, 16, 18, 21, 24, 24.6, 27, 31, 38, 44, 52]

  return (
    <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-14 sm:px-8">
      <div>
        <div className="eyebrow">DEV ONLY</div>
        <h1 className="m-0 mt-3 font-display text-4xl font-medium">Design system</h1>
      </div>

      <Spec title="Logo">
        <div className="flex flex-wrap items-center gap-10">
          <LogoMark size={112} />
          <Logo size="lg" subline />
          <Logo />
        </div>
      </Spec>

      <Spec title="Color">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
          {COLORS.map(([n, hex]) => (
            <div key={n} className="flex flex-col gap-1.5">
              <div className="h-12 rounded-control border-hair border-line-strong" style={{ background: hex }} />
              <span className="text-[13px]">{n}</span>
              <span className="num text-xs text-muted">{hex}</span>
            </div>
          ))}
        </div>
      </Spec>

      <Spec title="Type">
        <div className="flex flex-col gap-3">
          <span className="font-display text-5xl font-medium tracking-[-0.03em]">Space Grotesk 48</span>
          <span className="font-display text-2xl font-medium">Space Grotesk 24</span>
          <span className="text-base">Inter 16 for interface text and body copy.</span>
          <span className="num text-[26px]">JetBrains Mono 1,284 · 24.6 m</span>
          <span className="label-mono">Mono label 11 / 14% tracking</span>
        </div>
      </Spec>

      <Spec title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn-primary">Launch explorer</button>
          <button className="btn-primary" disabled>Launch explorer</button>
          <button className="btn-primary"><Spinner size={16} />Detecting</button>
          <button className="btn-secondary">Re-run detection</button>
          <button className="btn-secondary" disabled>Re-run detection</button>
          <button className="btn-ghost">Clear area</button>
          <button className="btn-icon" aria-label="Zoom in">+</button>
          <ExportMenu items={[{ label: 'GeoJSON', ext: '.geojson', icon: 'polygon', onSelect: () => {} }, { label: 'Screenshot', ext: '.png', icon: 'screenshot', onSelect: () => {} }]} />
        </div>
      </Spec>

      <div className="grid gap-6 md:grid-cols-2">
        <Spec title="Segmented view switcher">
          <div className="flex flex-col gap-4">
            <Segmented label="View" value={view} onChange={setView} options={[{ value: '2d', label: '2D Map' }, { value: '3d', label: '3D Buildings' }, { value: 'pc', label: 'Point Cloud' }]} />
            <Segmented label="View (disabled)" value="2d" onChange={() => {}} disabled options={[{ value: '2d', label: '2D Map' }, { value: '3d', label: '3D Buildings' }]} />
          </div>
        </Spec>
        <Spec title="Layer toggle list">
          <SwitchRow label="Building footprints" checked={layers.a} onChange={(v) => setLayers({ ...layers, a: v })} swatch={{ border: '.75px solid #00C9A7', background: 'rgba(0,201,167,.3)' }} />
          <SwitchRow label="Height labels" checked={layers.b} onChange={(v) => setLayers({ ...layers, b: v })} swatch={{ border: '.75px solid #FF6B35' }} />
          <SwitchRow label="Ground (DTM)" checked={false} onChange={() => {}} disabled swatch={{ border: '.75px solid #2A3A57' }} />
        </Spec>
        <Spec title="Sliders">
          <Slider label="Min height" value={h} display={`${h.toFixed(1)} m`} min={0} max={50} step={0.5} onChange={setH} />
          <Slider label="Density · disabled" value={100} display="100%" min={5} max={100} onChange={() => {}} disabled />
        </Spec>
        <Spec title="Stat cards">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="BUILDINGS" value="1,284" keyValue />
            <StatCard label="FOOTPRINT" value="31.2" unit="ha" />
            <StatCard label="TALLEST" loading />
          </div>
        </Spec>
        <Spec title="Chart · height histogram">
          <HeightHistogram heights={heights} selectedHeight={24.6} />
        </Spec>
        <Spec title="Key values">
          <KeyValues items={[['Height', '24.6 m', 'orange'], ['Footprint', '412 m²'], ['Centroid', '52.37290, 4.89150']]} />
        </Spec>
        <Spec title="Progress stepper">
          <ProgressStepper
            variant="horizontal"
            steps={[
              { label: 'Fetch points', state: 'done' },
              { label: 'Ground filter', state: 'done' },
              { label: 'nDSM', state: 'active', percent: 64 },
              { label: 'Vectorize', state: 'queued' },
            ]}
          />
        </Spec>
        <Spec title="Loading">
          <div className="flex flex-col gap-3">
            <Spinner label="Fetching points…" className="text-sm" />
            <SkeletonLines />
            <span className="font-mono text-xs text-muted">Downloading AHN5 tile 1 of 2</span>
          </div>
        </Spec>
        <Spec title="Empty · no area">
          <EmptyState icon="area" title="Draw an area to begin" action={<button className="btn-secondary btn-toggle-on">Draw area</button>}>
            Use the rectangle or polygon tool. Areas up to 1 km² are supported.
          </EmptyState>
        </Spec>
        <Spec title="Empty · no results">
          <EmptyState icon="results" title="No buildings match" action={<button className="btn-secondary">Reset filters</button>}>
            Nothing in this area is above 3 m and 25 m². Lower the filters.
          </EmptyState>
        </Spec>
      </div>
    </div>
  )
}
