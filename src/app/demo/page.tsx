import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Scale,
  Fish,
  Home as HomeIcon,
  Shield,
  FileText,
  Phone,
  Mail,
} from "lucide-react";
import { ChatWidgetEmbed } from "./chat-widget-embed";

const NAV = [
  { label: "HOME", href: "#home", active: true },
  { label: "ABOUT US", href: "#about" },
  { label: "OUR SERVICES", href: "#services" },
  { label: "LEGAL RESOURCES", href: "#" },
  { label: "BLOG", href: "#" },
];

const SERVICES = [
  {
    title: "Criminal Law",
    icon: Scale,
    blurb:
      "Expert criminal defence guidance for individuals and businesses navigating complex legal proceedings.",
  },
  {
    title: "Seafood & Marine",
    icon: Fish,
    blurb:
      "Specialised legal advice for aquaculture, commercial fisheries and marine resource management.",
  },
  {
    title: "Property",
    icon: HomeIcon,
    blurb:
      "Conveyancing, leases and property disputes — particularly for waterfront and marine-adjacent assets.",
  },
  {
    title: "Asset Protection",
    icon: Shield,
    blurb:
      "Strategies to protect your business assets, family wealth and legal interests with structured planning.",
  },
  {
    title: "Estate Planning",
    icon: FileText,
    blurb:
      "Wills, powers of attorney and succession planning tailored to your circumstances.",
  },
];

export default function DemoLandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-10 h-20">
          <Link href="#home" className="flex items-center" aria-label="Aquarius Lawyers home">
            <Image
              src="/aquarius-logo.jpg"
              alt="Aquarius Lawyers"
              width={673}
              height={176}
              priority
              className="h-12 w-auto"
            />
          </Link>

          <nav aria-label="Primary" className="hidden lg:flex items-center gap-8">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`text-[13px] font-semibold tracking-wide transition-colors ${
                  item.active
                    ? "text-brand border-b-2 border-brand pb-1"
                    : "text-gray-800 hover:text-brand"
                }`}
              >
                {item.label}
              </a>
            ))}
            <a
              href="#contact"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-[13px] font-semibold tracking-wide text-white shadow-sm hover:bg-brand-dark transition-colors"
            >
              CONTACT US
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section
        id="home"
        className="relative overflow-hidden border-b border-gray-100"
      >
        <div className="mx-auto max-w-7xl grid lg:grid-cols-2 gap-12 items-center px-6 lg:px-10 py-20 lg:py-28">
          <div>
            <h1 className="font-heading text-5xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight text-gray-900">
              Legal Solution for{" "}
              <span className="block">today&apos;s issues!</span>
            </h1>
            <p className="mt-12 text-base font-bold text-gray-900">
              Reduced legal costs
            </p>
            <a
              href="#services"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3 text-sm font-semibold tracking-wider text-white shadow-md hover:bg-brand-dark transition-colors"
            >
              LEARN MORE
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="relative flex justify-center lg:justify-end">
            <Image
              src="/aquarius-fish.svg"
              alt=""
              aria-hidden
              width={520}
              height={520}
              priority
              className="w-full max-w-[520px] h-auto"
            />
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-24 bg-white">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-brand text-sm font-bold tracking-[0.25em]">
              SERVICES
            </p>
            <h2 className="mt-3 font-heading text-3xl lg:text-4xl font-bold text-gray-900">
              Aquarius Lawyers provides legal advice and business services in
              the following areas:
            </h2>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map(({ title, icon: Icon, blurb }) => (
              <article
                key={title}
                className="group rounded-2xl bg-white p-8 ring-1 ring-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_32px_rgba(97,187,202,0.18)] hover:-translate-y-0.5 transition-all"
              >
                <div className="h-14 w-14 rounded-xl bg-brand/10 flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-white transition-colors">
                  <Icon className="h-7 w-7" strokeWidth={1.75} />
                </div>
                <h3 className="mt-6 font-heading text-lg font-bold text-gray-900 tracking-wide uppercase">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">
                  {blurb}
                </p>
                <button
                  type="button"
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark transition-colors"
                >
                  Read more
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-24 bg-gray-50/60">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-brand text-sm font-bold tracking-[0.25em]">
              OUR MISSION & VISION
            </p>
            <h2 className="mt-3 font-heading text-3xl lg:text-5xl font-bold leading-tight text-gray-900">
              Changing the Future of Ocean Management for the Better
            </h2>
            <div className="mt-8 space-y-4 text-gray-600 leading-relaxed">
              <p>
                With more than 20 years&apos; legal and business experience, our
                expertise lies in advising and representing organisations and
                businesses on all issues pertaining to the marine environment.
                We have experience consulting on aquaculture, marine and
                fisheries law, maritime security and marine resources
                management.
              </p>
              <p>
                Whether your water-based business is in the start-up phase, just
                been purchased or you have been operating for some time, we can
                assist you in ensuring it is compliant and protects your asset.
              </p>
            </div>
            <a
              href="#contact"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3 text-sm font-semibold tracking-wider text-white shadow-md hover:bg-brand-dark transition-colors"
            >
              READ MORE
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-brand-light via-brand to-brand-dark relative overflow-hidden shadow-xl">
            <div className="absolute inset-0 opacity-80">
              <svg viewBox="0 0 400 300" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="wave" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                  </linearGradient>
                </defs>
                <path d="M0 220 Q 100 180 200 210 T 400 200 L 400 300 L 0 300 Z" fill="url(#wave)" />
                <path d="M0 250 Q 100 220 200 240 T 400 235 L 400 300 L 0 300 Z" fill="rgba(255,255,255,0.25)" />
                <path d="M0 280 Q 100 260 200 275 T 400 270 L 400 300 L 0 300 Z" fill="rgba(255,255,255,0.4)" />
              </svg>
            </div>
            <div className="absolute top-8 left-8 right-8 text-white">
              <p className="text-xs font-bold tracking-[0.2em] opacity-90">
                THE FISH LAWYER
              </p>
              <p className="mt-2 font-heading text-2xl font-bold leading-tight">
                Specialised marine legal expertise
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Get In Touch */}
      <section id="contact" className="py-20 bg-white">
        <div className="mx-auto max-w-5xl px-6 lg:px-10">
          <div className="rounded-3xl bg-brand text-white px-8 py-14 text-center shadow-xl">
            <h2 className="font-heading text-3xl lg:text-4xl font-bold">
              Get In Touch
            </h2>
            <p className="mt-3 text-white/90">
              Talk to the &lsquo;Fish Lawyer&rsquo; about a consultation for a
              Legal Strategy Session.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="mailto:hello@aquariuslawyers.com.au"
                className="inline-flex items-center gap-2 rounded-full border-2 border-white/90 px-7 py-3 text-sm font-semibold tracking-wider text-white hover:bg-white hover:text-brand transition-colors"
              >
                CONTACT US
                <ArrowRight className="h-4 w-4" />
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold tracking-wider text-brand hover:bg-gray-50 transition-colors"
              >
                <Phone className="h-4 w-4" />
                CALL US
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-dark text-white">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 py-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="font-heading text-xl font-bold">Aquarius Lawyers</h3>
            <p className="mt-4 text-sm text-white/85 leading-relaxed">
              Liability Limited by a scheme approved under the Professional
              Standards Legislation.
            </p>
          </div>
          <div>
            <h4 className="font-heading text-sm font-bold tracking-wide">
              Quick Links
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              {["About Us", "Our Services", "Blog", "Position Papers", "Privacy Policy"].map(
                (link) => (
                  <li key={link}>
                    <a href="#" className="text-white/85 hover:text-white underline-offset-4 hover:underline">
                      {link}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
          <div>
            <h4 className="font-heading text-sm font-bold tracking-wide">
              Contact
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-white/85">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span>hello@aquariuslawyers.com.au</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 flex-shrink-0" />
                <span>+61 (0) 000 000 000</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/15">
          <div className="mx-auto max-w-7xl px-6 lg:px-10 py-5 text-xs text-white/70">
            Copyright {new Date().getFullYear()} Aquarius Lawyers — Demo page
          </div>
        </div>
      </footer>

      {/* Floating Chat Widget — embeds the chatbot iframe in the bottom right */}
      <ChatWidgetEmbed src="/" />
    </div>
  );
}
