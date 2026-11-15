import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorerPage from './ExplorerPage'
import { SkyscanService } from '@/services'

// Mapbox needs WebGL; the test map just lets us "draw" an area.
const AOI = {
  type: 'Polygon',
  coordinates: [[[-122.317, 47.6235], [-122.315, 47.6235], [-122.315, 47.6248], [-122.317, 47.6248], [-122.317, 47.6235]]],
}
const BIG_AOI = {
  type: 'Polygon',
  coordinates: [[[-122.4, 47.6], [-122.3, 47.6], [-122.3, 47.65], [-122.4, 47.65], [-122.4, 47.6]]],
}
vi.mock('@/components/explorer/MapView', () => ({
  MAPBOX_TOKEN: 'test',
  default: ({ onAoiDrawn }) => (
    <div>
      <button onClick={() => onAoiDrawn(AOI)}>test-draw</button>
      <button onClick={() => onAoiDrawn(BIG_AOI)}>test-draw-big</button>
    </div>
  ),
}))

vi.mock('@/services', () => ({
  SkyscanService: {
    getCities: vi.fn(),
    getSurveys: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    getJobLayer: vi.fn(),
    exportUrl: vi.fn((id, f) => `/api/jobs/${id}/export/?format=${f}`),
    coverageTiles: vi.fn(() => '/tiles'),
  },
}))

const building = (id, h) => ({
  type: 'Feature',
  id,
  geometry: AOI,
  properties: { id, epoch: 'single', height_m: h, max_height_m: h + 1, est_floors: Math.round(h / 3), area_m2: 120, volume_m3: 120 * h, point_count: 900, confidence: 0.8 },
})

const doneJob = {
  id: 'job-1',
  mode: 'measure',
  status: 'done',
  progress: 100,
  stage_message: 'Done',
  aoi: AOI,
  dataset: { name: 'WA_KingCo_1_2021', acquisition_year: 2021 },
  stats: {
    method: 'ndsm',
    processing_seconds: 41.2,
    validation: {
      available: true, source: 'overture', precision: 0.81, recall: 0.77, f1: 0.79, mean_iou: 0.74,
      true_positives: 20, reference: 26, iou_threshold: 0.5, height_compared: 18, height_mae_m: 2.1,
    },
  },
}

function renderExplorer(url = '/explore?mode=measure') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/explore" element={<ExplorerPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Explorer measure flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    SkyscanService.getCities.mockResolvedValue([])
    SkyscanService.getSurveys.mockResolvedValue({
      count: 1,
      results: [{ id: 7, name: 'WA_KingCo_1_2021', acquisition_year: 2021, covers_whole_area: true }],
      change_possible: false,
    })
  })

  it('draws an area, runs a job, follows progress and shows results', async () => {
    const user = userEvent.setup()
    SkyscanService.createJob.mockResolvedValue({ id: 'job-1', status: 'queued' })
    SkyscanService.getJob
      .mockResolvedValueOnce({ ...doneJob, status: 'fetching', progress: 10, stage_message: 'Streaming points from WA_KingCo_1_2021', stats: {} })
      .mockResolvedValue(doneJob)
    SkyscanService.getJobLayer.mockResolvedValue({ type: 'FeatureCollection', features: [building(1, 9.5), building(2, 31)] })

    renderExplorer()
    const run = screen.getByRole('button', { name: 'Measure buildings' })
    expect(run).toBeDisabled()

    await user.click(screen.getByText('test-draw'))
    expect(await screen.findByText(/Survey: WA_KingCo_1_2021 \(2021\)/)).toBeInTheDocument()
    expect(screen.getByText('0.022')).toBeInTheDocument() // live area readout, km²

    await user.click(run)
    expect(SkyscanService.createJob).toHaveBeenCalledWith({ mode: 'measure', aoi: AOI })

    // Stepper reflects the job's real stage.
    expect(await screen.findByText('Scanning')).toBeInTheDocument()
    expect(screen.getByText('Streaming points from WA_KingCo_1_2021')).toBeInTheDocument()

    // Results arrive when the job is done.
    // The panel re-renders as results load, so query it fresh each time.
    const panel = () => screen.getByRole('complementary', { name: 'Results' })
    await screen.findByRole('complementary', { name: 'Results' }, { timeout: 5000 })
    await waitFor(() => expect(within(panel()).getByText('Buildings').nextSibling).toHaveTextContent('2'))
    expect(within(panel()).getByText('Accuracy vs Overture')).toBeInTheDocument()
    expect(within(panel()).getByText('0.79')).toBeInTheDocument() // F1 from the API, not invented
    expect(within(panel()).getByRole('link', { name: 'CSV' })).toHaveAttribute('href', '/api/jobs/job-1/export/?format=csv')
    expect(SkyscanService.getJobLayer).toHaveBeenCalledWith('job-1', 'buildings', { epoch: 'single' })
  })

  it('warns when the area is over the limit and blocks running', async () => {
    const user = userEvent.setup()
    renderExplorer()
    await user.click(screen.getByText('test-draw-big'))
    expect(screen.getByRole('alert')).toHaveTextContent('Over the 1 km² limit')
    expect(screen.getByRole('button', { name: 'Measure buildings' })).toBeDisabled()
    expect(SkyscanService.getSurveys).not.toHaveBeenCalled()
  })

  it('shows the API error when a job cannot be created', async () => {
    const user = userEvent.setup()
    SkyscanService.createJob.mockRejectedValue({
      response: { status: 429, data: { detail: 'The server is busy with other jobs.' } },
    })
    renderExplorer()
    await user.click(screen.getByText('test-draw'))
    await screen.findByText(/Survey:/)
    await user.click(screen.getByRole('button', { name: 'Measure buildings' }))
    expect(await screen.findByText('The server is busy with other jobs.')).toBeInTheDocument()
  })

  it('reports when no survey covers the area', async () => {
    const user = userEvent.setup()
    SkyscanService.getSurveys.mockResolvedValue({ count: 0, results: [], change_possible: false })
    renderExplorer()
    await user.click(screen.getByText('test-draw'))
    expect(await screen.findByText(/No LiDAR survey covers this area/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Measure buildings' })).toBeDisabled()
  })

  it('shows a failed job with its readable error', async () => {
    SkyscanService.getJob.mockResolvedValue({ ...doneJob, status: 'failed', error: 'No LiDAR survey covers this area.' })
    renderExplorer('/explore?mode=measure&job=job-9')
    expect(await screen.findByText('No LiDAR survey covers this area.')).toBeInTheDocument()
  })
})

const change = (id, type, hb, ha, area) => ({
  type: 'Feature',
  id,
  geometry: AOI,
  properties: {
    id, change_type: type, height_before_m: hb, height_after_m: ha,
    delta_height_m: (ha ?? 0) - (hb ?? 0), area_m2: area, volume_delta_m3: ((ha ?? 0) - (hb ?? 0)) * area, confidence: 0.9,
  },
})

const changeJob = {
  id: 'job-c',
  mode: 'change',
  status: 'done',
  progress: 100,
  aoi: AOI,
  dataset: { name: 'CO_DRCOG_2_2020', acquisition_year: 2020 },
  dataset_before: { name: 'CO_2013', acquisition_year: 2013 },
  stats: {
    before: { year: 2013, dataset: 'CO_2013', observed_density_ppm2: 4.9 },
    after: { year: 2020, dataset: 'CO_DRCOG_2_2020', observed_density_ppm2: 4.5 },
    vertical_offset_m: -0.045,
    vertical_noise_m: 0.044,
  },
}

describe('Explorer change flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    SkyscanService.getCities.mockResolvedValue([])
  })

  it('explains why change is unavailable where only one survey exists', async () => {
    const user = userEvent.setup()
    SkyscanService.getSurveys.mockResolvedValue({
      count: 1,
      results: [{ id: 1, name: 'WA_KingCo_1_2021', acquisition_year: 2021, covers_whole_area: true }],
      years: [2021],
      change_possible: false,
      change_reason: 'Only one LiDAR survey covers this whole area, so there is nothing to compare.',
      default_pair: null,
      min_years_apart: 3,
    })
    renderExplorer('/explore?mode=change')
    await user.click(screen.getByText('test-draw'))
    expect(await screen.findByText('Change not available here')).toBeInTheDocument()
    expect(screen.getByText(/Only one LiDAR survey covers this whole area/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detect change' })).toBeDisabled()
  })

  it('runs with the chosen survey pair and lists classified changes', async () => {
    const user = userEvent.setup()
    SkyscanService.getSurveys.mockResolvedValue({
      count: 2,
      results: [
        { id: 20, name: 'CO_DRCOG_2_2020', acquisition_year: 2020, covers_whole_area: true, point_density_ppm2: 4.5 },
        { id: 13, name: 'CO_2013', acquisition_year: 2013, covers_whole_area: true, point_density_ppm2: 4.9 },
      ],
      years: [2013, 2020],
      change_possible: true,
      default_pair: [13, 20],
      min_years_apart: 3,
    })
    SkyscanService.createJob.mockResolvedValue({ id: 'job-c' })
    SkyscanService.getJob.mockResolvedValue(changeJob)
    SkyscanService.getJobLayer.mockImplementation((id, layer) =>
      Promise.resolve(
        layer === 'changes'
          ? { type: 'FeatureCollection', features: [change(1, 'new', null, 42.5, 2400), change(2, 'demolished', 13.1, null, 900), change(3, 'raised', 10.5, 18.7, 1300)] }
          : { type: 'FeatureCollection', features: [] }
      )
    )
    renderExplorer('/explore?mode=change')
    await user.click(screen.getByText('test-draw'))
    expect(await screen.findByText('7 years apart')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Detect change' }))
    expect(SkyscanService.createJob).toHaveBeenCalledWith({ mode: 'change', aoi: AOI, dataset_before: 13, dataset: 20 })

    await screen.findByRole('complementary', { name: 'Results' }, { timeout: 5000 })
    const panel = () => screen.getByRole('complementary', { name: 'Results' })
    expect(await within(panel()).findByText('2013 → 2020')).toBeInTheDocument()
    // Each type shows its count with a label (never colour alone).
    const types = within(panel()).getByRole('group', { name: 'Filter by change type' })
    expect(within(types).getByRole('button', { name: /New\s*1/ })).toBeInTheDocument()
    expect(within(types).getByRole('button', { name: /Demolished\s*1/ })).toBeInTheDocument()

    // Clicking a change in the list opens its before/after detail.
    const list = within(panel()).getAllByRole('listitem')
    expect(list).toHaveLength(3)
    await user.click(within(list[0]).getByRole('button'))
    const detail = within(panel()).getByRole('region', { name: 'Selected change' })
    expect(within(detail).getByText('42.5 m')).toBeInTheDocument()
    expect(within(detail).getByText('none')).toBeInTheDocument()

    // Turning a type off filters the list.
    await user.click(within(types).getByRole('button', { name: /New\s*1/ }))
    expect(within(panel()).getAllByRole('listitem')).toHaveLength(2)
    expect(SkyscanService.exportUrl).toHaveBeenCalledWith('job-c', 'csv', { layer: 'changes' })
  })
})
