import React from 'react'

// Adapted from 21st.dev "Feature Section with Bento Grid" by @tommyjepsen
// (https://21st.dev/@tommyjepsen/components/feature-section-with-bento-grid).
// Changes for this repo: light bg-muted tokens -> dark glass to match the
// landing page, content is props-driven, cards alternate wide/square per the
// original 2-1/1-2 bento rhythm.

export interface BentoFeature {
  icon: React.ElementType
  title: string
  text: string
  /** Wide cards span 2 columns on lg screens. */
  wide?: boolean
}

interface BentoFeaturesProps {
  badge?: string
  heading: string
  subheading?: string
  features: BentoFeature[]
  id?: string
  className?: string
}

export function BentoFeatures({ badge, heading, subheading, features, id, className = '' }: BentoFeaturesProps) {
  return (
    <section id={id} className={`bg-gray-950 py-24 ${className}`}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          {badge && (
            <span className="px-4 py-1.5 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-300/30 text-blue-100">
              {badge}
            </span>
          )}
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">{heading}</h2>
          {subheading && <p className="text-gray-400 max-w-2xl">{subheading}</p>}
        </div>

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, text, wide }) => (
            <div
              key={title}
              className={`rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col justify-between gap-10 backdrop-blur-sm transition-colors hover:border-blue-400/40 hover:bg-white/[0.07] ${
                wide ? 'lg:col-span-2 aspect-square sm:aspect-auto sm:min-h-[240px]' : 'aspect-square sm:aspect-auto sm:min-h-[240px]'
              }`}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15 text-sky-300">
                <Icon className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-semibold tracking-tight text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-400 max-w-md">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
