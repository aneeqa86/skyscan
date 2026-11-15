/**
 * Before / after survey pickers for Change mode, from the surveys covering the
 * drawn area. Explains why Change is unavailable when it is.
 */
export default function SurveyPicker({ surveys, pair, setPair }) {
  const usable = (surveys.results || []).filter((d) => d.covers_whole_area && d.acquisition_year)
  const years = surveys.years || []
  const minGap = surveys.min_years_apart ?? 3

  if (!surveys.change_possible) {
    return (
      <div className="panel w-72 p-3" role="alert">
        <p className="label text-orange">Change not available here</p>
        <p className="mt-2 text-xs text-fg">{surveys.change_reason}</p>
        <p className="mt-2 text-xs text-muted">
          {years.length ? `Survey years here: ${years.join(', ')}.` : 'No dated survey covers this whole area.'} Change
          needs two surveys at least {minGap} years apart that each cover the whole area.
        </p>
      </div>
    )
  }

  const byId = Object.fromEntries(usable.map((d) => [d.id, d]))
  const b = byId[pair.before]
  const a = byId[pair.after]
  const gap = a && b ? a.acquisition_year - b.acquisition_year : null
  const bad = gap !== null && gap < minGap

  const select = (key, value) => setPair({ ...pair, [key]: value ? Number(value) : null })
  const option = (d) => (
    <option key={d.id} value={d.id}>
      {d.acquisition_year} · {d.point_density_ppm2 ? `${d.point_density_ppm2.toFixed(1)} pts/m²` : 'density unknown'} · {d.name}
    </option>
  )

  return (
    <div className="panel w-72 space-y-2 p-3">
      <p className="label">Compare surveys</p>
      <p className="text-xs text-muted">Years available here: {years.join(', ')}</p>
      <label className="block text-xs text-muted">
        Before
        <select className="input mt-1 py-1 text-xs" value={pair.before ?? ''} onChange={(e) => select('before', e.target.value)}>
          <option value="">Choose a survey</option>
          {usable.map(option)}
        </select>
      </label>
      <label className="block text-xs text-muted">
        After
        <select className="input mt-1 py-1 text-xs" value={pair.after ?? ''} onChange={(e) => select('after', e.target.value)}>
          <option value="">Choose a survey</option>
          {usable.map(option)}
        </select>
      </label>
      {bad && (
        <p role="alert" className="text-xs text-orange">
          Pick a Before survey at least {minGap} years earlier than After.
        </p>
      )}
      {gap !== null && !bad && <p className="num text-xs text-teal">{gap} years apart</p>}
    </div>
  )
}
