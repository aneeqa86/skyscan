import { Outlet, useLocation } from 'react-router-dom'
import Footer from './Footer'
import Navbar from './Navbar'

export default function MainLayout() {
  // The landing page renders its own header inside the hero grid.
  const landing = useLocation().pathname === '/'
  return (
    <div className="flex min-h-screen flex-col bg-void">
      {!landing && <Navbar />}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
