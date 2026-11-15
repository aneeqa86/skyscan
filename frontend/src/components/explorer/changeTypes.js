/** Change types: colour always paired with a label and an icon. */
export const CHANGE_TYPES = [
  { key: 'new', label: 'New', icon: '+', color: '#00C9A7', text: 'text-teal' },
  { key: 'demolished', label: 'Demolished', icon: '×', color: '#FF6B35', text: 'text-orange' },
  { key: 'raised', label: 'Raised', icon: '↑', color: '#7FE3D2', text: 'text-teal-light' },
  { key: 'extended', label: 'Extended', icon: '⤢', color: '#7FE3D2', text: 'text-teal-light' },
  { key: 'lowered', label: 'Lowered', icon: '↓', color: '#FFB08C', text: 'text-orange-light' },
  { key: 'reduced', label: 'Reduced', icon: '⤡', color: '#FFB08C', text: 'text-orange-light' },
]

export const CHANGE_BY_KEY = Object.fromEntries(CHANGE_TYPES.map((t) => [t.key, t]))

export const changeColorExpr = [
  'match',
  ['get', 'change_type'],
  ...CHANGE_TYPES.flatMap((t) => [t.key, t.color]),
  '#8A97AD',
]
