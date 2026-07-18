import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Star } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// Adapted from 21st.dev "Modern Pricing Table" by @chowlol202
// (https://21st.dev/@chowlol202/components/modern-pricing-table).
// Changes for this repo: light/dark token styling -> fixed dark glass for the
// landing page, USD -> INR with en-IN digit grouping, featured accent
// blue/purple -> brand blue/cyan, heading is props-driven, CTAs are callbacks.

export interface Plan {
  title: string
  price: {
    monthly: number
    yearly: number
  }
  description: string
  features: string[]
  ctaText: string
  ctaHref: string
  isFeatured?: boolean
}

interface PricingTableProps {
  heading?: string
  subheading?: string
  plans: Plan[]
  id?: string
}

const AnimatedDigit: React.FC<{ digit: string; index: number }> = ({ digit, index }) => (
  <div className="relative inline-block min-w-[0.6ch] overflow-hidden text-center">
    <AnimatePresence mode="wait">
      <motion.span
        key={digit}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -20, opacity: 0 }}
        transition={{ duration: 0.3, delay: index * 0.05, ease: [0.4, 0, 0.2, 1] }}
        className="block"
      >
        {digit}
      </motion.span>
    </AnimatePresence>
  </div>
)

const ScrollingNumber: React.FC<{ value: number }> = ({ value }) => (
  <div className="flex items-center">
    {value
      .toLocaleString('en-IN')
      .split('')
      .map((digit, index) => (
        <AnimatedDigit key={`${value}-${index}`} digit={digit} index={index} />
      ))}
  </div>
)

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1 },
}

export default function PricingTable({ heading = 'Choose your plan', subheading, plans, id }: PricingTableProps) {
  const [isYearly, setIsYearly] = useState(false)

  return (
    <section id={id} className="bg-gray-950 py-24">
      <div className="mx-auto w-full max-w-6xl space-y-14 px-6">
        <motion.div
          className="space-y-8 text-center"
          initial={{ opacity: 0, y: -20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <div className="space-y-4">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">{heading}</h2>
            {subheading && <p className="mx-auto max-w-2xl text-gray-400">{subheading}</p>}
          </div>

          <div className="flex items-center justify-center">
            <Tabs
              value={isYearly ? 'yearly' : 'monthly'}
              onValueChange={(value) => setIsYearly(value === 'yearly')}
            >
              <TabsList className="flex h-12 w-full cursor-pointer bg-white/10 text-gray-400">
                <TabsTrigger
                  value="monthly"
                  className="flex-1 cursor-pointer px-4 text-base font-medium data-[state=active]:bg-gray-900 data-[state=active]:text-white"
                >
                  Monthly
                </TabsTrigger>
                <TabsTrigger
                  value="yearly"
                  className="flex flex-1 cursor-pointer items-center gap-2 px-4 text-base font-medium data-[state=active]:bg-gray-900 data-[state=active]:text-white"
                >
                  Yearly
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300">
                    Save 20%
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {plans.map((plan, index) => (
            <motion.div key={plan.title} variants={cardVariants} className="relative">
              {plan.isFeatured && (
                <div className="absolute -top-4 left-1/2 z-10 -translate-x-1/2">
                  <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/25">
                    <Star className="size-3 fill-current" />
                    Most Popular
                  </div>
                </div>
              )}

              <div
                className={cn(
                  'relative h-full rounded-2xl border-2 p-8 transition-all duration-300',
                  plan.isFeatured
                    ? 'border-blue-500/60 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 shadow-lg shadow-blue-500/10'
                    : 'border-white/10 bg-white/5 hover:border-blue-400/30',
                )}
              >
                <div className="mb-8 space-y-4 text-center">
                  <h3 className="text-2xl font-bold text-white">{plan.title}</h3>
                  <p className="text-sm text-gray-400">{plan.description}</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-center text-4xl font-bold tabular-nums text-white">
                      ₹
                      <ScrollingNumber
                        value={isYearly ? Math.round(plan.price.yearly / 12) : plan.price.monthly}
                      />
                      <span className="ml-1 text-lg font-normal text-gray-400">/month</span>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                      <span>{isYearly ? 'billed yearly' : 'billed monthly'}</span>
                      {isYearly && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                          Save ₹{(plan.price.monthly * 12 - plan.price.yearly).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-8 space-y-4">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-3">
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-400/15">
                        <Check className="size-3 text-sky-300" />
                      </div>
                      <span className="text-sm text-gray-300">{feature}</span>
                    </div>
                  ))}
                </div>

                <a
                  href={plan.ctaHref}
                  className={cn(
                    'block w-full rounded-lg py-3 text-center text-sm font-semibold transition-all',
                    plan.isFeatured
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:from-blue-600 hover:to-cyan-600 shadow-sm shadow-blue-500/25'
                      : 'border border-white/15 bg-white/5 text-white hover:bg-white/10',
                  )}
                >
                  {plan.ctaText}
                </a>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
