import Navbar from '@/components/layout/Navbar'

export default function ExplorerPage() {
  return (
    <div className="flex h-screen flex-col">
      <Navbar compact />
      <div className="flex flex-1 items-center justify-center text-sm text-muted">The explorer loads here.</div>
    </div>
  )
}
