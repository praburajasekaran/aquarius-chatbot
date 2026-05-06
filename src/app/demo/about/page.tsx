import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Phone,
  Mail,
} from "lucide-react";
import { ChatWidgetEmbed } from "../chat-widget-embed";

const NAV = [
  { label: "HOME", href: "/demo" },
  { label: "ABOUT US", href: "/demo/about", active: true },
  { label: "OUR SERVICES", href: "/demo#services" },
  { label: "LEGAL RESOURCES", href: "#" },
  { label: "BLOG", href: "#" },
];

export default function DemoAboutPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-10 h-20">
          <Link href="/demo" className="flex items-center" aria-label="Aquarius Lawyers home">
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
              <Link
                key={item.label}
                href={item.href}
                className={`text-[13px] font-semibold tracking-wide transition-colors ${
                  item.active
                    ? "text-brand border-b-2 border-brand pb-1"
                    : "text-gray-800 hover:text-brand"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <a
              href="/demo#contact"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-[13px] font-semibold tracking-wide text-white shadow-sm hover:bg-brand-dark transition-colors"
            >
              CONTACT US
            </a>
          </nav>
        </div>
      </header>

      {/* Page banner */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/ocean-banner.jpeg"
            alt=""
            aria-hidden
            fill
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-dark/80 via-brand/60 to-brand-dark/40" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 lg:px-10 py-20 lg:py-28">
          <h1 className="font-heading text-5xl lg:text-6xl font-extrabold text-white tracking-tight drop-shadow">
            About Us
          </h1>
        </div>
        <svg viewBox="0 0 1440 80" className="relative block w-full" preserveAspectRatio="none">
          <path d="M0 40 Q 360 0 720 40 T 1440 40 L 1440 80 L 0 80 Z" fill="#ffffff" />
        </svg>
      </section>

      {/* Mission & Vision */}
      <section className="py-20 bg-white">
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
              <p>
                If you have a regulatory issue, a contract dispute or just
                require some legal agreements we can assist.
              </p>
              <p className="font-semibold text-gray-900">
                Book a Legal Strategy Session with us today!
              </p>
            </div>
            <a
              href="/demo#contact"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3 text-sm font-semibold tracking-wider text-white shadow-md hover:bg-brand-dark transition-colors"
            >
              READ MORE
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-xl">
            <Image
              src="/ocean-banner.jpeg"
              alt="Marine environment"
              fill
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* Talk to the Fish Lawyer */}
      <section className="py-20 bg-gray-50/60">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <h2 className="text-center font-heading text-3xl lg:text-4xl font-bold text-gray-900">
            Talk to the Fish Lawyer!
          </h2>

          <div className="mt-12 grid lg:grid-cols-2 gap-10 items-stretch">
            <div className="relative rounded-2xl overflow-hidden ring-1 ring-gray-200 shadow-lg aspect-[4/5] lg:aspect-auto">
              <Image
                src="/katherine-hawes.jpg"
                alt="Katherine Hawes, Principal of Aquarius Lawyers"
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            </div>

            <div className="rounded-2xl bg-brand text-white p-8 lg:p-10 shadow-xl">
              <div className="space-y-4 leading-relaxed text-white/95">
                <p>
                  Don&apos;t flap around in the water! If you have a legal issue
                  or question – choose the law firm with{" "}
                  <span className="font-bold">&ldquo;The Fish Lawyer&rdquo;</span>.
                </p>
                <p>Engaging an expert saves time and money for your business.</p>
                <p>
                  Aquarius Lawyers is the law firm for assisting those
                  businesses working in the marine environment with all their
                  legal issues. Our firm can provide advice and representation
                  in all areas marine business, commercial fisheries,
                  aquaculture and international law.
                </p>
                <p>
                  Known as &ldquo;The Fish Lawyer&rdquo; for her specialization
                  in aquaculture, marine and fisheries law, Katherine Hawes is
                  the principal of Aquarius Lawyers. Katherine&apos;s unique
                  blend of business and maritime expertise means that you will
                  be provided with a specialized and professional legal
                  solution. The aim is to provide cost effective legal and
                  compliance solutions for your business.
                </p>
                <p>
                  Katherine is a regular speaker at international events on
                  legal issues affecting the marine environment and has
                  completed a Masters of Maritime Law. We understand that the
                  legal system can be a maze but through sound legal advice we
                  aim to guide you through that maze to find the best legal
                  solution for you.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Board Appointments */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <h2 className="text-center font-heading text-3xl lg:text-4xl font-bold text-gray-900">
            Board Appointments &amp; Professional Representation
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            <article className="rounded-2xl bg-white p-8 ring-1 ring-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex flex-col items-center text-center">
              <div className="relative h-32 w-32 flex items-center justify-center">
                <Image
                  src="/awf-logo.jpg"
                  alt="Aquaculture Without Frontiers logo"
                  width={200}
                  height={200}
                  className="h-32 w-auto object-contain"
                />
              </div>
              <p className="mt-6 text-sm leading-relaxed text-gray-600">
                Katherine Hawes is also the Chairperson of Aquaculture Without
                Frontiers, which is an independent non-profit organisation that
                promotes and supports responsible and sustainable aquaculture
                and the alleviation of poverty by improving livelihoods in
                developing countries.
              </p>
            </article>

            <article className="rounded-2xl bg-white p-8 ring-1 ring-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex flex-col items-center text-center">
              <div className="relative h-32 w-full flex items-center justify-center">
                <Image
                  src="/aisp-logo.jpg"
                  alt="Association of International Seafood Professionals logo"
                  width={300}
                  height={120}
                  className="h-20 w-auto object-contain"
                />
              </div>
              <p className="mt-6 text-sm leading-relaxed text-gray-600">
                Katherine Hawes is the founder and board member of the
                Association of International Seafood Professionals (AISP), to
                promote sustainable seafood development as a means of improving
                the nutrition and health of people, and to foster social and
                economic development.
              </p>
            </article>
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
              <li>
                <Link href="/demo/about" className="text-white/85 hover:text-white underline-offset-4 hover:underline">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/demo#services" className="text-white/85 hover:text-white underline-offset-4 hover:underline">
                  Our Services
                </Link>
              </li>
              {["Blog", "Position Papers", "Privacy Policy"].map((link) => (
                <li key={link}>
                  <a href="#" className="text-white/85 hover:text-white underline-offset-4 hover:underline">
                    {link}
                  </a>
                </li>
              ))}
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

      {/* Floating Chat Widget */}
      <ChatWidgetEmbed src="/" />
    </div>
  );
}
