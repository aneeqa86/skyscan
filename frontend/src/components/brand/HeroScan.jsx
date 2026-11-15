/**
 * Landing hero art (design package, Main.dc.html): a 3x3 isometric city block
 * scanned by a beacon, the tallest roof highlighted with its height reading.
 * The reading and HUD lines are passed in so they can show real values.
 */
const BLOCKS = [
  // [left face, right face, roof], back to front
  ['356,190 400,212 400,322 356,300', '400,212 444,190 444,300 400,322', '400,168 444,190 400,212 356,190'],
  ['416,270 460,292 460,352 416,330', '460,292 504,270 504,330 460,352', '460,248 504,270 460,292 416,270'],
  ['296,180 340,202 340,352 296,330', '340,202 384,180 384,330 340,352', '340,158 384,180 340,202 296,180'],
  ['476,270 520,292 520,382 476,360', '520,292 564,270 564,360 520,382', '520,248 564,270 520,292 476,270'],
  ['356,160 400,182 400,382 356,360', '400,182 444,160 444,360 400,382', '400,138 444,160 400,182 356,160', true],
  ['236,290 280,312 280,382 236,360', '280,312 324,290 324,360 280,382', '280,268 324,290 280,312 236,290'],
  ['416,260 460,282 460,412 416,390', '460,282 504,260 504,390 460,412', '460,238 504,260 460,282 416,260'],
  ['296,310 340,332 340,412 296,390', '340,332 384,310 384,390 340,412', '340,288 384,310 340,332 296,310'],
  ['356,370 400,392 400,442 356,420', '400,392 444,370 444,420 400,442', '400,348 444,370 400,392 356,370'],
]

const ring = { transformBox: 'fill-box', transformOrigin: 'center' }
const mono = { fontFamily: 'JetBrains Mono, monospace' }

export default function HeroScan({ reading = '41.2 m', hud = [], footer = [] }) {
  return (
    <svg
      viewBox="0 0 800 520"
      className="block h-auto w-full"
      role="img"
      aria-label={`Isometric city block scanned by a LiDAR beacon. The tallest rooftop is highlighted with a height reading of ${reading}.`}
    >
      <polygon points="400,270 580,360 400,450 220,360" fill="#0B1220" stroke="#2A3A57" strokeWidth=".75" />
      <g stroke="#1C2940" strokeWidth=".5" strokeDasharray="3 3">
        <line x1="340" y1="300" x2="520" y2="390" />
        <line x1="280" y1="330" x2="460" y2="420" />
        <line x1="460" y1="300" x2="280" y2="390" />
        <line x1="520" y1="330" x2="340" y2="420" />
      </g>
      <g fill="none" stroke="#00C9A7" strokeWidth=".8">
        {[0, 1.2, 2.4].map((d) => (
          <ellipse key={d} className="animate-pulse-ring" style={{ ...ring, animationDelay: `${d}s` }} cx="400" cy="360" rx="250" ry="125" />
        ))}
      </g>
      <g stroke="#2A3A57" strokeWidth=".75" strokeLinejoin="round">
        {BLOCKS.map(([l, r, roof, tallest], i) => (
          <g key={i}>
            <polygon points={l} fill="#0F1A2E" />
            <polygon points={r} fill="#0A111F" />
            <polygon points={roof} fill={tallest ? '#FF6B35' : '#122038'} stroke={tallest ? '#FF6B35' : '#00C9A7'} />
          </g>
        ))}
      </g>
      <g stroke="#00C9A7" strokeWidth=".9" strokeDasharray="4 4">
        <line className="animate-beam" x1="400" y1="64" x2="400" y2="160" />
        <line className="animate-beam" x1="400" y1="64" x2="340" y2="180" />
        <line className="animate-beam" x1="400" y1="64" x2="520" y2="270" />
        <line className="animate-beam" x1="400" y1="64" x2="280" y2="290" />
      </g>
      <g fill="#00C9A7">
        <circle cx="340" cy="180" r="2.5" />
        <circle cx="520" cy="270" r="2.5" />
        <circle cx="280" cy="290" r="2.5" />
      </g>
      <g fill="none" stroke="#00C9A7" strokeWidth=".8">
        {[0, 1.2, 2.4].map((d) => (
          <circle key={d} className="animate-pulse-ring" style={{ ...ring, animationDelay: `${d}s` }} cx="400" cy="64" r="46" />
        ))}
      </g>
      <circle cx="400" cy="64" r="5" fill="#FF6B35" />
      <line x1="400" y1="160" x2="470" y2="112" stroke="#FF6B35" strokeWidth=".75" />
      <rect x="470" y="92" width="112" height="40" fill="#070B14" stroke="#FF6B35" strokeWidth=".75" />
      <text x="482" y="108" fontSize="11" fill="#8C9BB3" letterSpacing="1.2" style={mono}>
        ROOF HEIGHT
      </text>
      <text x="482" y="125" fontSize="15" fill="#FF6B35" style={mono}>
        {reading}
      </text>
      {hud.map((t, i) => (
        <text key={t} x="24" y={40 + i * 18} fontSize="12" fill="#8C9BB3" letterSpacing="1" style={mono}>
          {t}
        </text>
      ))}
      {footer[0] && (
        <text x="24" y="498" fontSize="12" fill="#8C9BB3" letterSpacing="1" style={mono}>
          {footer[0]}
        </text>
      )}
      {footer[1] && (
        <text x="776" y="498" textAnchor="end" fontSize="12" fill="#8C9BB3" letterSpacing="1" style={mono}>
          {footer[1]}
        </text>
      )}
    </svg>
  )
}
