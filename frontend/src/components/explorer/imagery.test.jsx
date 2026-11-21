import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImageryTimeline, imageryDefaults, imageryFilterTest } from './imagery'

const changeJob = {
  mode: 'change',
  stats: {
    imagery: {
      available: true,
      years: [2011, 2013, 2015, 2017, 2019, 2021].map((year) => ({ year })),
      corroboration: { reference_years: [2013, 2021] },
    },
  },
}

describe('imagery helpers', () => {
  it('defaults the swipe to the years standing in for the two surveys', () => {
    expect(imageryDefaults(changeJob)).toMatchObject({ left: 2013, right: 2021 })
  })

  it('defaults a measure job to the image nearest its survey', () => {
    const job = { mode: 'measure', stats: { dataset_year: 2014, imagery: { available: true, years: [{ year: 2015 }, { year: 2023 }] } } }
    expect(imageryDefaults(job).right).toBe(2015)
  })

  it('has no years without imagery', () => {
    expect(imageryDefaults({ stats: { imagery: { available: false } } }).years).toEqual([])
  })

  it('filters changes by the imagery check', () => {
    expect(imageryFilterTest('seen', { imagery_status: 'likely' })).toBe(true)
    expect(imageryFilterTest('confirmed', { imagery_status: 'likely' })).toBe(false)
    expect(imageryFilterTest('noveg', { imagery_status: 'vegetation' })).toBe(false)
    expect(imageryFilterTest('all', { imagery_status: 'vegetation' })).toBe(true)
  })
})

describe('ImageryTimeline', () => {
  it('marks LiDAR years, picks a year and shows when the selected change became visible', async () => {
    const onYear = vi.fn()
    render(
      <ImageryTimeline
        years={[2013, 2015, 2017]}
        lidarYears={[2013, 2016]}
        year={2013}
        onYear={onYear}
        selected={{ imagery_first_year: 2017, imagery_window_start: 2015 }}
        provider="USDA NAIP"
      />
    )
    expect(screen.getByRole('button', { name: '2013' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '2016' })).toBeNull() // a survey year without an image
    expect(screen.getByText('Visible from 2017, not in 2015')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '2017' }))
    expect(onYear).toHaveBeenCalledWith(2017)
  })
})
