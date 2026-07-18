import { SessionNavBar } from "@/components/ui/sidebar"

/**
 * Standalone preview of the hover-to-expand SessionNavBar sidebar.
 * Visit /sidebar-preview while logged in. Hover the left rail to expand it.
 */
export default function SidebarPreview() {
  return (
    <div className="flex h-screen w-screen flex-row bg-gray-50">
      <SessionNavBar />
      {/* pad past the collapsed (3.05rem) rail so content isn't hidden under it */}
      <main className="flex h-screen grow flex-col overflow-auto pl-[3.05rem]">
        <div className="p-8">
          <h1 className="text-2xl font-bold text-gray-900">Sidebar preview</h1>
          <p className="mt-2 max-w-prose text-gray-600">
            Hover over the left rail to expand it. Nav links route to the real
            app pages and highlight based on the current route; the account menu
            shows the logged-in user and signs out. When you're happy with it,
            we can swap it into the main app layout.
          </p>
        </div>
      </main>
    </div>
  )
}
