import { Outlet } from 'react-router-dom'
import { SessionNavBar } from '@/components/ui/sidebar'
import Header from './Header'

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <SessionNavBar />
      {/* pad past the collapsed (3.05rem) rail; the sidebar overlays content when expanded on hover */}
      <div className="flex flex-col flex-1 min-w-0 pl-[3.05rem]">
        <Header />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
