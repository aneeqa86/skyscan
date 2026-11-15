/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // SKYSCAN brand tokens. Dark only: near-black navy, teal, orange.
        ink: {
          950: '#05080F',
          900: '#070B14', // page background
          850: '#0A101C',
          800: '#0D1524', // panels
          700: '#131D31', // raised surfaces, inputs
          600: '#1C2840',
        },
        line: 'rgba(148, 163, 184, 0.16)',
        'line-strong': 'rgba(148, 163, 184, 0.32)',
        fg: '#E6EDF7',
        muted: '#8A97AD',
        faint: '#5B6880',
        teal: { DEFAULT: '#00C9A7', light: '#7FE3D2', dim: '#00876F' },
        orange: { DEFAULT: '#FF6B35', light: '#FFB08C', dim: '#B8481F' },
        primary: {
          50: '#E6FBF7',
          100: '#C0F4EA',
          200: '#7FE3D2',
          300: '#3DD6BC',
          400: '#00C9A7',
          500: '#00C9A7',
          600: '#00A88C',
          700: '#00876F',
          800: '#006653',
          900: '#004538',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderWidth: { hair: '0.5px' },
      keyframes: {
        pulsering: {
          '0%': { transform: 'scale(0.4)', opacity: '0.9' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        dash: { to: { strokeDashoffset: '-24' } },
        scan: {
          '0%': { transform: 'translateY(-10%)', opacity: '0' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { transform: 'translateY(110%)', opacity: '0' },
        },
      },
      animation: {
        pulsering: 'pulsering 2.4s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        dash: 'dash 1.2s linear infinite',
        scan: 'scan 3.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
