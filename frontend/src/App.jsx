import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PageSpinner } from '@/components/ui'
import MainLayout from '@/components/layout/MainLayout'
import { ThemeProvider } from '@/context/ThemeContext'
import AboutPage from '@/pages/AboutPage'
import DatasetsPage from '@/pages/DatasetsPage'
import LandingPage from '@/pages/LandingPage'
import NotFoundPage from '@/pages/NotFoundPage'

// The explorer pulls in Mapbox GL and deck.gl; load it only when needed.
const ExplorerPage = lazy(() => import('@/pages/ExplorerPage'))
const DesignSystemPage = lazy(() => import('@/pages/DesignSystemPage'))

/** Old /explore links keep working. */
function LegacyExplore() {
  const { search } = useLocation()
  return <Navigate to={`/explorer${search}`} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/datasets" element={<DatasetsPage />} />
          <Route path="/about" element={<AboutPage />} />
          {import.meta.env.DEV && (
            <Route
              path="/design-system"
              element={
                <Suspense fallback={<PageSpinner />}>
                  <DesignSystemPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route
          path="/explorer"
          element={
            <Suspense fallback={<PageSpinner label="Loading the explorer" />}>
              <ExplorerPage />
            </Suspense>
          }
        />
        <Route path="/explore" element={<LegacyExplore />} />
      </Routes>
    </ThemeProvider>
  )
}
