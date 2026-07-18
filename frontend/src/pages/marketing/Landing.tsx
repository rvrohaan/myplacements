import { useEffect, useState } from 'react'
import {
  BarChart3,
  Bot,
  GraduationCap,
  Home,
  IndianRupee,
  LayoutGrid,
  LineChart,
  ListChecks,
  MessagesSquare,
  Quote,
  Rocket,
  Search,
  Sparkles,
} from 'lucide-react'
import Hero from '@/components/ui/animated-shader-hero'
import { GlassmorphismNavBar } from '@/components/ui/glassmorphism-navbar'
import { BentoFeatures, type BentoFeature } from '@/components/ui/bento-features'
import { HowItWorks, type HowItWorksStep } from '@/components/ui/how-it-works'
import { StaggerTestimonials, type TestimonialItem } from '@/components/ui/stagger-testimonials'
import PricingTable, { type Plan } from '@/components/ui/modern-pricing-table'
import FindPortalModal from '@/pages/marketing/FindPortalModal'

// Public marketing home page, served on the apex domain (myplacements.in).
// Colleges live on their own subdomains; this page just sells the product.

// Bento rhythm: wide, square / square, wide.
const FEATURES: BentoFeature[] = [
  {
    icon: Bot,
    title: 'AI Auto-Allocation',
    text: 'AI matches every company to the right placement officer — region, sector, relationship history, workload and priority all considered. You preview, review, then apply.',
    wide: true,
  },
  {
    icon: GraduationCap,
    title: 'Student Portal',
    text: 'AI mock interviews, resume reviews, skill reports and drive applications — one login for every student.',
  },
  {
    icon: MessagesSquare,
    title: 'Communication Tracking',
    text: 'Every recruiter call, mail and visit logged against the company, with follow-ups that never slip.',
  },
  {
    icon: LineChart,
    title: 'Placement Analytics',
    text: 'Live dashboards for drives, offers and branch-wise outcomes — with reports ready for NAAC and NIRF submissions the day they are due.',
    wide: true,
  },
]

const STEPS: HowItWorksStep[] = [
  {
    icon: <Rocket className="h-6 w-6" strokeWidth={1.5} />,
    title: 'Onboard your college',
    description: 'Get your own portal on a dedicated subdomain and bring your data over in minutes.',
    benefits: [
      'yourcollege.myplacements.in from day one',
      'Excel import for students and companies',
      'Role-based access for the whole placement team',
    ],
  },
  {
    icon: <Bot className="h-6 w-6" strokeWidth={1.5} />,
    title: 'Run drives with AI',
    description: 'Let AI allocate officers to companies and keep every drive and follow-up on track.',
    benefits: [
      'AI officer-to-company allocation',
      'Drive rounds and offer tracking',
      'Communication log with follow-up alerts',
    ],
  },
  {
    icon: <BarChart3 className="h-6 w-6" strokeWidth={1.5} />,
    title: 'Place students and prove it',
    description: 'Students prepare in their own portal while you watch outcomes move in real time.',
    benefits: [
      'AI mock interviews and resume review',
      'Live branch-wise analytics',
      'NAAC/NIRF-ready reports',
    ],
  },
]

// PLACEHOLDER testimonials — swap for real quotes (and real photos) before launch.
const TESTIMONIALS: TestimonialItem[] = [
  {
    testimonial: 'Our officers stopped juggling spreadsheets in week one. Drives that took days to coordinate now take hours.',
    by: 'Dr. Meera Nair, TPO at an engineering college',
    imgSrc: 'https://i.pravatar.cc/150?img=1',
  },
  {
    testimonial: 'The AI allocation is uncannily good — it paired our fintech recruiters with the officer who knew them best.',
    by: 'Rajesh Kumar, Placement Head',
    imgSrc: 'https://i.pravatar.cc/150?img=2',
  },
  {
    testimonial: 'Students actually prepare now. The mock interviews feel real enough that the real ones feel easy.',
    by: 'Ananya S., Final-year CSE student',
    imgSrc: 'https://i.pravatar.cc/150?img=3',
  },
  {
    testimonial: 'NAAC asked for placement data; we exported it in one afternoon instead of one month.',
    by: 'Prof. Venkatesh Rao, Principal',
    imgSrc: 'https://i.pravatar.cc/150?img=4',
  },
  {
    testimonial: 'Follow-ups used to fall through the cracks. Now nothing does.',
    by: 'Divya Menon, Placement Officer',
    imgSrc: 'https://i.pravatar.cc/150?img=5',
  },
  {
    testimonial: 'We onboarded 3,000 students from Excel in under an hour.',
    by: 'Suresh Patil, Placement Coordinator',
    imgSrc: 'https://i.pravatar.cc/150?img=6',
  },
  {
    testimonial: 'Branch-wise analytics finally gave management the visibility they kept asking for.',
    by: 'Kavitha R., Deputy TPO',
    imgSrc: 'https://i.pravatar.cc/150?img=7',
  },
  {
    testimonial: 'Best decision our placement cell made this year.',
    by: 'Arjun Mehta, Training & Placement Officer',
    imgSrc: 'https://i.pravatar.cc/150?img=8',
  },
]

// Management hasn't signed off on pricing yet — flip this to true to show the
// pricing section (and its nav item) once the figures below are approved.
const SHOW_PRICING = false

// PLACEHOLDER pricing — figures and the sales mailto need real decisions.
const PLANS: Plan[] = [
  {
    title: 'Starter',
    price: { monthly: 4999, yearly: 47990 },
    description: 'For smaller colleges getting their placement cell organised',
    features: [
      'Up to 1,000 students',
      'Company database & drive management',
      'Student portal with AI practice',
      'Excel import for students & companies',
      'Email support',
    ],
    ctaText: 'Book a Demo',
    ctaHref: 'mailto:hello@myplacements.in?subject=MyPlacements%20Demo%20-%20Starter',
  },
  {
    title: 'Professional',
    price: { monthly: 9999, yearly: 95990 },
    description: 'For established placement cells that want AI doing the legwork',
    features: [
      'Up to 5,000 students',
      'Everything in Starter',
      'AI officer auto-allocation',
      'Communication tracking & follow-up alerts',
      'Training monitoring',
      'Analytics with NAAC/NIRF-ready reports',
      'Priority support',
    ],
    ctaText: 'Book a Demo',
    ctaHref: 'mailto:hello@myplacements.in?subject=MyPlacements%20Demo%20-%20Professional',
    isFeatured: true,
  },
  {
    title: 'Enterprise',
    price: { monthly: 19999, yearly: 191990 },
    description: 'For universities and college groups running multiple campuses',
    features: [
      'Unlimited students',
      'Everything in Professional',
      'Multi-college console',
      'Custom onboarding & data migration',
      'Dedicated success manager',
    ],
    ctaText: 'Contact Sales',
    ctaHref: 'mailto:hello@myplacements.in?subject=MyPlacements%20Enterprise',
  },
]

// Section id -> nav item name, in page order.
const SECTION_NAV: Array<[string, string]> = [
  ['hero', 'Home'],
  ['features', 'Features'],
  ['how-it-works', 'How It Works'],
  ['testimonials', 'Testimonials'],
  ...(SHOW_PRICING ? ([['pricing', 'Pricing']] as Array<[string, string]>) : []),
]

export default function Landing() {
  const [activeSection, setActiveSection] = useState('Home')
  const [finderOpen, setFinderOpen] = useState(false)

  const scrollTo = (id: string) => () =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  // Scroll-spy: the section crossing a thin band around the viewport middle
  // owns the navbar highlight, so exactly one item is active at a time.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const match = SECTION_NAV.find(([id]) => id === entry.target.id)
          if (match) setActiveSection(match[1])
        }
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    )
    for (const [id] of SECTION_NAV) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div className="bg-black">
      {/* Brand wordmark, clear of the centered nav pill. */}
      <a
        href="/"
        className="fixed top-6 left-6 z-50 hidden sm:flex items-center gap-2 text-white font-semibold tracking-tight"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-blue-400 to-cyan-400" />
        MyPlacements
      </a>

      <GlassmorphismNavBar
        active={activeSection}
        items={[
          {
            name: 'Home',
            icon: Home,
            action: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
          },
          { name: 'Features', icon: LayoutGrid, action: scrollTo('features') },
          { name: 'How It Works', icon: ListChecks, action: scrollTo('how-it-works') },
          { name: 'Testimonials', icon: Quote, action: scrollTo('testimonials') },
          ...(SHOW_PRICING
            ? [{ name: 'Pricing', icon: IndianRupee, action: scrollTo('pricing') }]
            : []),
          { name: 'Find Portal', icon: Search, action: () => setFinderOpen(true) },
        ]}
      />

      <section id="hero">
      <Hero
        trustBadge={{
          icon: <Sparkles className="h-4 w-4" />,
          text: 'AI-powered placement management for colleges',
        }}
        headline={{ line1: 'Campus Placements,', line2: 'Reimagined with AI' }}
        subtitle="One platform for placement cells to manage companies, drives, students and training — with AI that allocates officers, reviews resumes and coaches students for interviews."
        buttons={{
          primary: { text: 'Find Your Portal', onClick: () => setFinderOpen(true) },
          secondary: { text: 'Learn More', onClick: scrollTo('features') },
        }}
      />
      </section>

      <BentoFeatures
        id="features"
        badge="Platform"
        heading="Everything your placement cell runs on"
        subheading="Built for placement officers, heads and students — each college on its own secure subdomain."
        features={FEATURES}
      />

      <HowItWorks
        id="how-it-works"
        heading="Up and running in three steps"
        subheading="From onboarding to placement reports — the whole cycle lives in one place."
        steps={STEPS}
      />

      <StaggerTestimonials
        id="testimonials"
        heading="Loved by placement teams"
        subheading="Placement officers, principals and students on what changed after the switch."
        testimonials={TESTIMONIALS}
      />

      {SHOW_PRICING && (
        <PricingTable
          id="pricing"
          heading="Simple pricing for every college"
          subheading="One subscription per college — every officer, student and drive included. No per-seat surprises."
          plans={PLANS}
        />
      )}

      <footer className="border-t border-white/10 bg-gray-950 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} MyPlacements. All rights reserved.</span>
          <button onClick={() => setFinderOpen(true)} className="text-blue-400 hover:text-blue-300">
            Find your college portal →
          </button>
        </div>
      </footer>

      {finderOpen && <FindPortalModal onClose={() => setFinderOpen(false)} />}
    </div>
  )
}
