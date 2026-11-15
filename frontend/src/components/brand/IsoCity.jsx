import { useId, useMemo } from 'react'

const COS = Math.cos(Math.PI / 6)
const SIN = Math.sin(Math.PI / 6)

/** Isometric projection of a ground-plane point (x, y) at height z. */
function iso(x, y, z = 0) {
  return [(x - y) * COS, (x + y) * SIN - z]
}

// Strokes keep a fixed screen width (thin lines) at any size.
const NS = { vectorEffect: 'non-scaling-stroke' }

const pts = (list) => list.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' ')

function boxFaces({ x, y, w, d, h }) {
  const g = [iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)]
  const t = [iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)]
  return {
    top: t,
    left: [t[3], t[2], g[2], g[3]], // facing the viewer, lower left
    right: [t[1], t[2], g[2], g[1]], // facing the viewer, lower right
    roofCenter: iso(x + w / 2, y + d / 2, h),
  }
}

export const LOGO_BLOCKS = [
  { x: 0, y: 0, w: 3, d: 3, h: 7 },
  { x: 4, y: 0, w: 3, d: 2, h: 4 },
  { x: 0, y: 4, w: 2, d: 3, h: 3 },
  { x: 3, y: 4, w: 4, d: 3, h: 10 },
]

/**
 * IsoCity: an isometric block of buildings scanned by a LiDAR beacon.
 * Pure SVG + CSS animation (reduced-motion users see a still image).
 *
 * @param {Array} blocks    buildings as {x, y, w, d, h} in grid units
 * @param {number} unit     pixels per grid unit
 * @param {boolean} beams   draw dashed scan lines from the beacon to rooftops
 * @param {boolean} animate pulse rings and moving dashes
 */
export default function IsoCity({
  blocks = LOGO_BLOCKS,
  unit = 6,
  beams = true,
  animate = true,
  strokeWidth = 1,
  className,
  title = 'Isometric city block scanned by a LiDAR beacon',
}) {
  const id = useId().replace(/:/g, '')
  const scene = useMemo(() => {
    // Back to front so nearer buildings overlap farther ones.
    const ordered = [...blocks].sort((a, b) => a.x + a.y - (b.x + b.y))
    const faces = ordered.map(boxFaces)
    const all = faces.flatMap((f) => [...f.top, ...f.left, ...f.right])
    const xs = all.map((p) => p[0])
    const ys = all.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const beacon = [(minX + maxX) / 2, minY - 6]
    return { faces, minX, maxX, minY: beacon[1] - 3.5, maxY, beacon }
  }, [blocks])

  const pad = 1.5
  const vb = [
    scene.minX - pad,
    scene.minY - pad,
    scene.maxX - scene.minX + pad * 2,
    scene.maxY - scene.minY + pad * 2,
  ]
  const [bx, by] = scene.beacon
  // Sizes in screen pixels, converted to drawing units.
  const dot = (2.5 + unit * 0.12) / unit
  const ring = dot * 2.2
  const hit = (1.2 + unit * 0.05) / unit

  return (
    <svg
      viewBox={vb.map((v) => v.toFixed(2)).join(' ')}
      width={vb[2] * unit}
      height={vb[3] * unit}
      className={className}
      role="img"
      aria-labelledby={`${id}-t`}
    >
      <title id={`${id}-t`}>{title}</title>
      <g fill="none" strokeLinejoin="round" strokeWidth={strokeWidth}>
        {scene.faces.map((f, i) => (
          <g key={i}>
            <polygon points={pts(f.left)} fill="#0D1524" stroke="#00C9A7" strokeOpacity="0.55" {...NS} />
            <polygon points={pts(f.right)} fill="#0A101C" stroke="#00C9A7" strokeOpacity="0.55" {...NS} />
            <polygon points={pts(f.top)} fill="#131D31" stroke="#00C9A7" {...NS} />
          </g>
        ))}
        {beams &&
          scene.faces.map((f, i) => (
            <line
              key={`b${i}`}
              x1={bx}
              y1={by}
              x2={f.roofCenter[0]}
              y2={f.roofCenter[1]}
              stroke="#FF6B35"
              strokeOpacity="0.8"
              strokeDasharray="3 4"
              {...NS}
              className={animate ? 'animate-dash' : undefined}
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        {beams &&
          scene.faces.map((f, i) => (
            <circle key={`h${i}`} cx={f.roofCenter[0]} cy={f.roofCenter[1]} r={hit} fill="#FF6B35" stroke="none" />
          ))}
      </g>
      {/* Beacon with concentric pulse rings */}
      <g transform={`translate(${bx} ${by})`}>
        {animate &&
          [0, 0.8, 1.6].map((delay) => (
            <circle
              key={delay}
              r={ring}
              fill="none"
              stroke="#FF6B35"
              strokeWidth={1}
              {...NS}
              className="animate-pulsering"
              style={{ animationDelay: `${delay}s`, transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          ))}
        <circle r={ring} fill="none" stroke="#FF6B35" strokeWidth={1} strokeOpacity="0.5" {...NS} />
        <circle r={dot} fill="#FF6B35" />
      </g>
    </svg>
  )
}
