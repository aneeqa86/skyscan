import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PageSpinner } from '@/components/ui'
import MainLayout from '@/components/layout/MainLayout'
import { ThemeProvider } from '@/context/ThemeContext'
import AboutPage from '@/pages/AboutPage'
import LandingPage from '@/pages/LandingPage'
import NotFoundPage from '@/pages/NotFoundPage'

// The explorer pulls in Mapbox GL and deck.gl; load it only when needed.
const ExplorerPage = lazy(() => import('@/pages/ExplorerPage'))

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route
          path="/explore"
          element={
            <Suspense fallback={<PageSpinner />}>
              <ExplorerPage />
            </Suspense>
          }
        />
      </Routes>
    </ThemeProvider>
  )
}
