import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { cn, STATUS_COLORS } from '@/lib/utils'

export interface StatusOption<T extends string> {
  value: T
  label: string
}

/**
 * A pill-shaped dropdown whose menu renders in a portal (so it isn't clipped by
 * scroll containers) with fully rounded corners. Colors come from STATUS_COLORS.
 */
export default function StatusSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: StatusOption<T>[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateCoords = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.left })
  }

  useLayoutEffect(() => {
    if (open) updateCoords()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => updateCoords()
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors',
          STATUS_COLORS[value]
        )}
      >
        {current?.label ?? value.replace(/_/g, ' ')}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-50 w-40 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden py-1"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className={cn('px-2 py-0.5 rounded-full', STATUS_COLORS[opt.value])}>{opt.label}</span>
                {opt.value === value && <Check className="w-3.5 h-3.5 text-primary-600" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
