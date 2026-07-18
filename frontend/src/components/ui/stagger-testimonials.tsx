import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Adapted from 21st.dev "Stagger Testimonials" by @vaib215
// (https://21st.dev/@vaib215/components/stagger-testimonials).
// Changes for this repo: shadcn tokens -> fixed dark-glass styling to match
// the landing page, testimonials are props-driven, section wrapper + heading
// added to match the other landing sections.

const SQRT_5000 = Math.sqrt(5000)

export interface TestimonialItem {
  testimonial: string
  by: string
  imgSrc: string
}

type PositionedTestimonial = TestimonialItem & { tempId: number }

interface TestimonialCardProps {
  position: number
  testimonial: PositionedTestimonial
  handleMove: (steps: number) => void
  cardSize: number
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({
  position,
  testimonial,
  handleMove,
  cardSize,
}) => {
  const isCenter = position === 0

  return (
    <div
      onClick={() => handleMove(position)}
      className={cn(
        'absolute left-1/2 top-1/2 cursor-pointer border-2 p-8 transition-all duration-500 ease-in-out',
        isCenter
          ? 'z-10 border-blue-500 bg-gradient-to-br from-blue-600 to-cyan-600 text-white'
          : 'z-0 border-white/10 bg-gray-900 text-white hover:border-blue-400/50',
      )}
      style={{
        width: cardSize,
        height: cardSize,
        clipPath: `polygon(50px 0%, calc(100% - 50px) 0%, 100% 50px, 100% 100%, calc(100% - 50px) 100%, 50px 100%, 0 100%, 0 0)`,
        transform: `
          translate(-50%, -50%)
          translateX(${(cardSize / 1.5) * position}px)
          translateY(${isCenter ? -65 : position % 2 ? 15 : -15}px)
          rotate(${isCenter ? 0 : position % 2 ? 2.5 : -2.5}deg)
        `,
        boxShadow: isCenter ? '0px 8px 0px 4px rgba(255, 255, 255, 0.08)' : 'none',
      }}
    >
      <span
        className="absolute block origin-top-right rotate-45 bg-white/10"
        style={{ right: -2, top: 48, width: SQRT_5000, height: 2 }}
      />
      <img
        src={testimonial.imgSrc}
        alt={testimonial.by.split(',')[0]}
        loading="lazy"
        className="mb-4 h-14 w-12 bg-gray-800 object-cover object-top"
        style={{ boxShadow: '3px 3px 0px rgba(0, 0, 0, 0.6)' }}
      />
      <h3 className={cn('text-base sm:text-xl font-medium', isCenter ? 'text-white' : 'text-gray-100')}>
        &ldquo;{testimonial.testimonial}&rdquo;
      </h3>
      <p
        className={cn(
          'absolute bottom-8 left-8 right-8 mt-2 text-sm italic',
          isCenter ? 'text-blue-100/90' : 'text-gray-500',
        )}
      >
        - {testimonial.by}
      </p>
    </div>
  )
}

interface StaggerTestimonialsProps {
  heading?: string
  subheading?: string
  testimonials: TestimonialItem[]
  id?: string
  className?: string
}

export function StaggerTestimonials({
  heading,
  subheading,
  testimonials,
  id,
  className,
}: StaggerTestimonialsProps) {
  const [cardSize, setCardSize] = useState(365)
  const [list, setList] = useState<PositionedTestimonial[]>(() =>
    testimonials.map((t, i) => ({ ...t, tempId: i })),
  )

  const handleMove = (steps: number) => {
    const newList = [...list]
    if (steps > 0) {
      for (let i = steps; i > 0; i--) {
        const item = newList.shift()
        if (!item) return
        newList.push({ ...item, tempId: Math.random() })
      }
    } else {
      for (let i = steps; i < 0; i++) {
        const item = newList.pop()
        if (!item) return
        newList.unshift({ ...item, tempId: Math.random() })
      }
    }
    setList(newList)
  }

  useEffect(() => {
    const updateSize = () => {
      const { matches } = window.matchMedia('(min-width: 640px)')
      setCardSize(matches ? 365 : 290)
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const arrowClasses = cn(
    'flex h-14 w-14 items-center justify-center text-2xl transition-colors',
    'border-2 border-white/10 bg-gray-900 text-white hover:bg-blue-600 hover:border-blue-500',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950',
  )

  return (
    <section id={id} className={cn('bg-gray-950 py-24', className)}>
      {(heading || subheading) && (
        <div className="mx-auto mb-4 max-w-3xl px-6 text-center">
          {heading && (
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">{heading}</h2>
          )}
          {subheading && <p className="mt-4 text-gray-400">{subheading}</p>}
        </div>
      )}
      <div className="relative w-full overflow-hidden" style={{ height: 600 }}>
        {list.map((testimonial, index) => {
          const position =
            list.length % 2 ? index - (list.length + 1) / 2 : index - list.length / 2
          return (
            <TestimonialCard
              key={testimonial.tempId}
              testimonial={testimonial}
              handleMove={handleMove}
              position={position}
              cardSize={cardSize}
            />
          )
        })}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          <button onClick={() => handleMove(-1)} className={arrowClasses} aria-label="Previous testimonial">
            <ChevronLeft />
          </button>
          <button onClick={() => handleMove(1)} className={arrowClasses} aria-label="Next testimonial">
            <ChevronRight />
          </button>
        </div>
      </div>
    </section>
  )
}
