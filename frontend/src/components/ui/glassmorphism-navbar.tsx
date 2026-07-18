import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

// Adapted from 21st.dev "Glassmorphism Navigation" by @akashsingh890901-crypto
// (https://21st.dev/@akashsingh890901-crypto/components/glassmorphism-navigation).
// Changes for this repo: light/dark theme toggle removed (it flipped the global
// `dark` class, which belongs to the staff app; the marketing page is always
// dark), token-based colors replaced with fixed dark-glass styling to match the
// shader hero, and items navigate via an action callback instead of tab state.

export interface GlassNavItem {
  name: string
  icon: React.ElementType
  action: () => void
}

interface GlassmorphismNavBarProps {
  items: GlassNavItem[]
  /** Name of the item highlighted with the "lamp" indicator. When provided
   *  (e.g. from a scroll-spy), it drives the highlight; clicks still update
   *  it immediately for responsiveness. */
  active?: string
  className?: string
}

export function GlassmorphismNavBar({ items, active, className }: GlassmorphismNavBarProps) {
  const [activeTab, setActiveTab] = useState(active ?? items[0]?.name)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (active !== undefined) setActiveTab(active)
  }, [active])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      className={cn(
        'fixed bottom-0 sm:bottom-auto sm:top-0 left-1/2 -translate-x-1/2 z-50 mb-6 sm:mb-0 sm:pt-6',
        className,
      )}
    >
      <div
        className="flex items-center gap-1 py-1 px-1 rounded-full shadow-lg bg-white/10 border border-white/15"
        style={{
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.name

          return (
            <button
              key={item.name}
              onClick={() => {
                setActiveTab(item.name)
                item.action()
              }}
              className={cn(
                'relative cursor-pointer text-sm font-semibold px-6 py-2 rounded-full transition-all duration-300',
                'text-blue-100/75 hover:text-white',
                isActive && 'text-white',
              )}
            >
              <span className={cn(isMobile && 'sr-only')}>{item.name}</span>
              {isMobile && <Icon size={18} strokeWidth={2.5} aria-hidden />}
              {isActive && (
                <motion.div
                  layoutId="lamp"
                  className="absolute inset-0 w-full rounded-full -z-10 bg-white/10"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full bg-sky-400/80">
                    <div className="absolute w-12 h-6 rounded-full blur-md -top-2 -left-2 bg-sky-400/30" />
                    <div className="absolute w-8 h-6 rounded-full blur-md -top-1 bg-sky-400/30" />
                    <div className="absolute w-4 h-4 rounded-full blur-sm top-0 left-2 bg-sky-400/30" />
                  </div>
                </motion.div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
