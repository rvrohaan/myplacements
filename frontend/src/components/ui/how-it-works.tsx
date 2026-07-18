import React from 'react'
import { cn } from '@/lib/utils'

// Adapted from 21st.dev "How It Works" by @ravikatiyar162
// (https://21st.dev/@ravikatiyar162/components/how-it-works).
// Changes for this repo: shadcn light tokens (bg-card/bg-muted) -> dark glass
// to match the landing page, steps are props-driven, hover scale toned down.

export interface HowItWorksStep {
  icon: React.ReactNode
  title: string
  description: string
  benefits: string[]
}

interface HowItWorksProps {
  heading?: string
  subheading?: string
  steps: HowItWorksStep[]
  id?: string
  className?: string
}

function StepCard({ icon, title, description, benefits }: HowItWorksStep) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm',
        'transition-all duration-300 ease-in-out hover:-translate-y-1 hover:border-blue-400/40 hover:bg-white/[0.07]',
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-sky-300">
        {icon}
      </div>
      <h3 className="mb-2 text-xl font-semibold text-white">{title}</h3>
      <p className="mb-6 text-sm leading-relaxed text-gray-400">{description}</p>
      <ul className="space-y-3">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-center gap-3">
            <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-sky-400/20">
              <div className="h-2 w-2 rounded-full bg-sky-400" />
            </div>
            <span className="text-sm text-gray-400">{benefit}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HowItWorks({ heading = 'How it works', subheading, steps, id, className }: HowItWorksProps) {
  return (
    <section id={id} className={cn('w-full bg-gray-950 py-24', className)}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">{heading}</h2>
          {subheading && <p className="mt-4 text-gray-400">{subheading}</p>}
        </div>

        {/* Step indicators with connecting line (desktop only — the line
            assumes the 3-column grid geometry) */}
        <div className="relative mx-auto mb-8 hidden w-full max-w-5xl md:block">
          <div
            aria-hidden="true"
            className="absolute left-[16.6667%] top-1/2 h-0.5 w-[66.6667%] -translate-y-1/2 bg-white/10"
          />
          <div className="relative grid grid-cols-3">
            {steps.map((_, index) => (
              <div
                key={index}
                className="flex h-8 w-8 items-center justify-center justify-self-center rounded-full bg-blue-500/15 text-sm font-semibold text-sky-300 ring-4 ring-gray-950"
              >
                {index + 1}
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <StepCard key={step.title} {...step} />
          ))}
        </div>
      </div>
    </section>
  )
}
