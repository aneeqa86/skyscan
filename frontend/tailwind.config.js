/** @type {import('tailwindcss').Config} */
// SKYSCAN design tokens (source: design package, src/styles/tokens.css).
// Dark theme only. Teal is the accent; orange only for the active scan state,
// the selected building and one key value per view.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#070B14',
        panel: '#0B1220',
        raised: '#101A2C',
        sunken: '#0D1627', // disabled control fill
        mapbg: '#090F1C',
        line: '#1C2940',
        'line-strong': '#2A3A57',
        gridline: '#111B30',
        fg: '#E8EEF6',
        muted: '#8C9BB3',
        disabled: '#5E6E87',
        'on-teal': '#031411',
        teal: { DEFAULT: '#00C9A7', hover: '#19D9B8', fill: 'rgba(0, 201, 167, 0.14)', light: '#7FE3D2', dim: '#00A88C' },
        orange: { DEFAULT: '#FF6B35', fill: 'rgba(255, 107, 53, 0.28)', light: '#FFB08C' },
        cls: { ground: '#6F7F9C', vegetation: '#9DBF5A', building: '#00C9A7' },
        h: { 0: '#2B4C7E', 1: '#2A8FA8', 2: '#00C9A7', 3: '#E8B45C', 4: '#FF6B35' },
        // Aliases kept for older class names.
        ink: { 950: '#05080F', 900: '#070B14', 850: '#0B1220', 800: '#0B1220', 700: '#101A2C', 600: '#2A3A57' },
        faint: '#5E6E87',
        primary: { 400: '#00C9A7', 500: '#00C9A7', 600: '#00A88C' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { badge: '2px', control: '3px', card: '4px' },
      borderWidth: { hair: '0.5px', stroke: '0.75px' },
      spacing: { target: '44px' },
      maxWidth: { page: '1280px' },
      keyframes: {
        'pulse-ring': { '0%': { transform: 'scale(.15)', opacity: '.9' }, '100%': { transform: 'scale(1)', opacity: '0' } },
        'beam-flow': { to: { strokeDashoffset: '-16' } },
        skeleton: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.4' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 3.6s ease-out infinite',
        beam: 'beam-flow 1.4s linear infinite',
        skeleton: 'skeleton 1.6s ease-in-out infinite',
        spin: 'spin 0.9s linear infinite',
      },
    },
  },
  plugins: [],
}
