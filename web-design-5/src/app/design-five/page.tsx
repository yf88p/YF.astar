import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Bodoni_Moda } from "next/font/google";
import { ContactButton, ProjectLink } from "@/components/agency-interactions";
import styles from "./page.module.css";

const luxury = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-luxury",
  display: "swap",
});

const heroImage =
  "https://images.unsplash.com/photo-1547234935-80c7145ec969?auto=format&fit=crop&w=2400&q=90";

export const metadata: Metadata = {
  title: "MONOGRAM | A Distinct Point of View",
  description:
    "An independent creative studio shaping distinctive brands, digital experiences, and visual worlds for the culturally curious. Based in London. Working everywhere.",
  openGraph: {
    title: "MONOGRAM | A Distinct Point of View",
    description:
      "Strategy, identity, and art direction. Considered in every detail. Unmistakable as a whole.",
    type: "website",
    images: [
      {
        url: heroImage,
        width: 2400,
        height: 1594,
        alt: "Rust-colored mountains and a sweeping desert landscape in Wadi Rum",
      },
    ],
  },
};

const projects = [
  {
    number: "01",
    title: "Maison Aurel",
    category: "Hospitality & Places",
    year: "2026",
    subtitle: "A slower kind of extraordinary.",
    description:
      "A new expression of Mediterranean hospitality. We shaped the positioning, visual identity, and digital experience for a collection of intimate residences, taking our cues from sun-warmed stone, local rituals, and the pleasure of an unhurried stay.",
    services: [
      "Brand strategy",
      "Visual identity",
      "Digital experience",
      "Art direction",
    ],
    outcome:
      "A complete brand world, from the first online encounter to the smallest detail in the room. One considered identity across three distinctive destinations.",
    image:
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85",
    alt: "Sunlight across a thoughtfully furnished interior with natural materials and warm leather",
    treatment: "interior",
    wordmark: "maison aurel",
    imageLabel: "The art of being somewhere.",
  },
  {
    number: "02",
    title: "Serein",
    category: "Beauty & Wellbeing",
    year: "2026",
    subtitle: "An everyday ritual. An uncommon feeling.",
    description:
      "A botanical skincare brand with nothing to hide. An elemental identity, tactile packaging, and an editorial commerce experience bring Serein's quiet confidence to life, balancing scientific integrity with a deeply sensorial point of view.",
    services: [
      "Positioning",
      "Naming",
      "Packaging",
      "E-commerce",
      "Campaign direction",
    ],
    outcome:
      "A launch-ready system spanning six formulations, responsible packaging, and a digital flagship designed around the daily ritual rather than the hard sell.",
    image:
      "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=1000&q=85",
    alt: "An amber glass serum bottle on a sculptural wooden pedestal, framed by botanical shadows",
    treatment: "beauty",
    wordmark: "serein",
    imageLabel: "Return to yourself.",
  },
  {
    number: "03",
    title: "Forme Editions",
    category: "Design & Culture",
    year: "2025",
    subtitle: "Objects with a life of their own.",
    description:
      "For an independent design gallery championing collectible objects, we created an identity that makes room for the unexpected. A flexible typographic system meets a richly editorial website, giving each maker and each material a story worth spending time with.",
    services: [
      "Brand identity",
      "Editorial design",
      "Website",
      "Creative direction",
    ],
    outcome:
      "A distinctive platform for a growing roster of international makers, with a new collection journal and an intuitive enquiry-led digital catalogue.",
    image:
      "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=1000&q=85",
    alt: "Handcrafted blue-gray ceramic bowls and plates arranged on weathered wooden shelves",
    treatment: "objects",
    wordmark: "forme.",
    imageLabel: "Objects. Ideas. Other perspectives.",
  },
  {
    number: "04",
    title: "The Elsewhere",
    category: "Travel & Lifestyle",
    year: "2025",
    subtitle: "For those who take the other road.",
    description:
      "An independent travel journal for people led by curiosity. We translated an adventurous editorial spirit into a cinematic brand, a collectible print edition, and an immersive digital home that puts the feeling of a place before its coordinates.",
    services: [
      "Brand strategy",
      "Art direction",
      "Publication design",
      "Digital design",
    ],
    outcome:
      "A unified print and digital launch with a visual language that travels effortlessly from long-form stories to destination guides and photographic essays.",
    image:
      "https://images.unsplash.com/photo-1473580044384-7ba9967e16a0?auto=format&fit=crop&w=1200&q=85",
    alt: "Sculptural sand dunes and wind-drawn patterns beneath the low desert sun",
    treatment: "landscape",
    wordmark: "ELSEWHERE",
    imageLabel: "A journal for the curious.",
  },
];

const expertise = [
  {
    title: "Strategy & Positioning",
    note: "Finding your uncommon truth.",
    description:
      "Before we make anything, we make sense of everything. Through research, conversation, and a little healthy questioning, we find the idea only your brand can own.",
    services: [
      "Brand discovery",
      "Positioning & purpose",
      "Audience insight",
      "Naming & narrative",
    ],
  },
  {
    title: "Identity & Expression",
    note: "Making the intangible, unmistakable.",
    description:
      "We build expressive identities with substance beneath the surface. Distinctive in their smallest detail and coherent across every encounter, they are made to evolve without losing their character.",
    services: [
      "Visual identity",
      "Verbal identity",
      "Packaging & print",
      "Brand guidelines",
    ],
  },
  {
    title: "Digital Experiences",
    note: "A feeling, not just a function.",
    description:
      "Digital should feel as considered as everything else you make. We bring editorial instinct, intuitive interaction, and thoughtful technology together in websites people want to spend time with.",
    services: [
      "Digital strategy",
      "UX & UI design",
      "E-commerce",
      "Web development",
    ],
  },
  {
    title: "Art Direction & Content",
    note: "Creating a world worth entering.",
    description:
      "We translate a point of view into a visual world. From the first moodboard to the final frame, we collaborate with exceptional image-makers to create work that feels specific, emotional, and enduring.",
    services: [
      "Campaign concepts",
      "Photography & film",
      "Editorial direction",
      "Creative production",
    ],
  },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={diagonal ? styles.diagonalArrow : undefined}
    >
      <path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MonogramMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 64h15M53 64h15M12 16h11l17 35 17-35h11M19 16v48M61 16v48M23 16v48M57 16v48M23 25l17 35 17-35M40 51v9"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M7 7h66v66H7z" stroke="currentColor" strokeWidth=".6" />
    </svg>
  );
}

export default function DesignFivePage() {
  return (
    <div className={`${styles.page} ${luxury.variable}`} id="top">
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>

      <section className={styles.hero} aria-labelledby="hero-title">
        <Image
          src={heroImage}
          alt="Monumental sandstone peaks rising through the haze above the rust-red sands of Wadi Rum"
          fill
          preload
          unoptimized
          sizes="100vw"
          className={styles.heroImage}
        />
        <div className={styles.heroShade} />

        <header className={styles.header}>
          <a href="#top" className={styles.logo} aria-label="Monogram home">
            MONOGRAM<span className={styles.logoDot}>®</span>
          </a>
          <span className={styles.headerNote}>
            Independent creative studio
            <br />
            London & everywhere
          </span>
          <nav className={styles.navigation} aria-label="Main navigation">
            <a href="#work">Work</a>
            <a href="#studio">Studio</a>
            <a href="#expertise">Expertise</a>
            <ContactButton
              studio="MONOGRAM"
              email="hello@monogram.studio"
              className={styles.navContact}
            >
              Let&apos;s talk <Arrow diagonal />
            </ContactButton>
          </nav>
        </header>

        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>
            <span className={styles.smallRule} /> A considered approach. An
            enduring impression.
          </p>
          <h1 id="hero-title">
            A distinct
            <br />
            <em>point of view.</em>
          </h1>
        </div>

        <div className={styles.heroSideNote} aria-hidden="true">
          A study in perspective / No. 001
        </div>

        <div className={styles.heroBottom}>
          <p>
            We shape brands, experiences, and visual worlds{" "}
            <br className={styles.desktopBreak} />
            for those who see things differently.
          </p>
          <a href="#work" className={styles.outlineButton}>
            Explore our work <Arrow diagonal />
          </a>
          <a href="#introduction" className={styles.scrollLink}>
            A little further{" "}
            <span className={styles.downArrow}>
              <Arrow />
            </span>
          </a>
        </div>
      </section>

      <main id="main-content">
        <section
          id="introduction"
          className={styles.introduction}
          aria-labelledby="intro-title"
        >
          <div className={styles.sectionLabel}>
            <span className={styles.sectionNumber}>01 /</span> The way we see it
          </div>
          <div className={styles.introContent}>
            <h2 id="intro-title">
              In a world of more,
              <br />
              we believe in <em>meaning.</em>
            </h2>
            <div className={styles.introBottom}>
              <p>
                MONOGRAM is an independent creative studio at the intersection
                of strategy, design, and culture. We work with ambitious people
                to create brands that don&apos;t just look different. They feel
                different.
              </p>
              <a href="#studio" className={styles.textLink}>
                Meet the studio <Arrow diagonal />
              </a>
            </div>
          </div>
        </section>

        <section id="work" className={styles.work} aria-labelledby="work-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>
                <span className={styles.sectionNumber}>02 /</span> A selection
                of our work
              </p>
              <h2 id="work-title">
                Distinct by <em>design.</em>
              </h2>
            </div>
            <span className={styles.archiveLabel}>
              Selected projects / 2025 &ndash; 2026
            </span>
          </div>

          <div className={styles.projectGrid}>
            {projects.map((project) => (
              <article key={project.number} className={styles.project}>
                <ProjectLink
                  title={project.title}
                  category={project.category}
                  description={project.description}
                  services={project.services}
                  outcome={project.outcome}
                  image={project.image}
                  className={styles.projectLink}
                >
                  <span
                    className={`${styles.projectImage} ${styles[project.treatment]}`}
                  >
                    <Image
                      src={project.image}
                      alt={project.alt}
                      fill
                      unoptimized
                      sizes="(max-width: 700px) 90vw, (max-width: 1100px) 44vw, 46vw"
                    />
                    <span className={styles.projectImageShade} />
                    <span className={styles.imageTopline}>
                      <span>MONOGRAM &times; {project.title}</span>
                      <span>{project.year}</span>
                    </span>
                    <span className={styles.projectWordmark}>
                      {project.wordmark}
                    </span>
                    <span className={styles.imageBottomline}>
                      {project.imageLabel}
                    </span>
                    <span className={styles.projectOpen}>
                      View project <Arrow diagonal />
                    </span>
                  </span>
                  <span className={styles.projectDetails}>
                    <span className={styles.projectNumber}>
                      {project.number}
                    </span>
                    <span className={styles.projectTitle}>{project.title}</span>
                    <span className={styles.projectCategory}>
                      {project.category}
                    </span>
                    <Arrow diagonal />
                  </span>
                </ProjectLink>
                <p className={styles.projectSubtitle}>{project.subtitle}</p>
              </article>
            ))}
          </div>
          <div className={styles.workEnd}>
            <span>Different worlds. The same depth of consideration.</span>
            <ContactButton
              studio="MONOGRAM"
              email="hello@monogram.studio"
              className={styles.textLink}
            >
              Your project could be next <Arrow diagonal />
            </ContactButton>
          </div>
        </section>

        <section
          id="expertise"
          className={styles.expertise}
          aria-labelledby="expertise-title"
        >
          <div className={styles.expertiseIntro}>
            <p className={styles.sectionLabel}>
              <span className={styles.sectionNumber}>03 /</span> Our expertise
            </p>
            <h2 id="expertise-title">
              From first thought
              <br />
              to <em>lasting feeling.</em>
            </h2>
            <p className={styles.bodyCopy}>
              One studio. A connected way of thinking. We bring clarity to the
              complex and character to every expression of your brand.
            </p>
            <MonogramMark className={styles.expertiseMark} />
          </div>
          <div className={styles.expertiseList}>
            {expertise.map((item, index) => (
              <details
                key={item.title}
                className={styles.expertiseItem}
                name="monogram-expertise"
                open={index === 0}
              >
                <summary>
                  <span className={styles.expertiseNumber}>0{index + 1}</span>
                  <span className={styles.expertiseTitle}>{item.title}</span>
                  <span className={styles.accordionIcon} aria-hidden="true" />
                </summary>
                <div className={styles.expertiseBody}>
                  <p className={styles.expertiseNote}>{item.note}</p>
                  <p>{item.description}</p>
                  <ul>
                    {item.services.map((service) => (
                      <li key={service}>{service}</li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section
          id="studio"
          className={styles.studio}
          aria-labelledby="studio-title"
        >
          <div className={styles.studioVisual}>
            <Image
              src="https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1100&q=85"
              alt="An airy creative space with a black communal table, sculptural staircase, and sunlight across natural oak floors"
              fill
              unoptimized
              sizes="(max-width: 700px) 100vw, 50vw"
            />
            <div className={styles.studioImageShade} />
            <span className={styles.studioImageNote}>
              A space for observation. And possibility.
            </span>
            <span className={styles.studioImageIndex}>
              Fig. 01 / The everyday, considered
            </span>
          </div>
          <div className={styles.studioContent}>
            <p className={styles.sectionLabel}>
              <span className={styles.sectionNumber}>04 /</span> The studio
            </p>
            <h2 id="studio-title">
              Small by choice.
              <br />
              <em>Open by nature.</em>
            </h2>
            <p className={styles.studioLead}>
              A close-knit team. An expansive perspective.
            </p>
            <p className={styles.bodyCopy}>
              We are strategists, designers, and image-makers, united by a
              curiosity for the world and a belief that good work begins with
              paying attention.
            </p>
            <p className={styles.bodyCopy}>
              Independent since 2018, we partner directly with founders and
              teams who care deeply about what they put into the world. No
              layers. No borrowed answers. Just an honest, collaborative pursuit
              of something exceptional.
            </p>
            <ContactButton
              studio="MONOGRAM"
              email="hello@monogram.studio"
              className={styles.textLink}
            >
              Get to know us <Arrow diagonal />
            </ContactButton>
            <div className={styles.studioFacts}>
              <div>
                <span>Established</span>
                <strong>2018</strong>
              </div>
              <div>
                <span>Based in</span>
                <strong>London</strong>
              </div>
              <div>
                <span>Working</span>
                <strong>Everywhere</strong>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.testimonial} aria-labelledby="quote-title">
          <p className={styles.sectionLabel} id="quote-title">
            In good company
          </p>
          <span className={styles.quoteMark} aria-hidden="true">
            &ldquo;
          </span>
          <figure>
            <blockquote>
              Every detail felt like it could only belong to us.
              <br className={styles.desktopBreak} /> That is the difference{" "}
              <em>MONOGRAM makes.</em>
            </blockquote>
            <figcaption>
              <span>Camille Laurent</span>
              <span>Founder, Maison Aurel</span>
            </figcaption>
          </figure>
          <div
            className={styles.clientNames}
            role="group"
            aria-label="Selected clients"
          >
            <span className={styles.clientAurel}>maison aurel</span>
            <span className={styles.clientSerein}>serein</span>
            <span className={styles.clientForme}>forme.</span>
            <span className={styles.clientElsewhere}>ELSEWHERE</span>
            <span className={styles.clientOrma}>O R M A</span>
          </div>
        </section>
      </main>

      <footer id="contact" className={styles.footer}>
        <div className={styles.footerTop}>
          <p className={styles.sectionLabel}>
            <span className={styles.availabilityDot} /> Open to new perspectives
          </p>
          <span className={styles.footerNote}>
            Great work starts with a conversation.
          </span>
        </div>
        <div className={styles.contactHeading}>
          <h2>
            Your next chapter,
            <br />
            <em>beautifully told.</em>
          </h2>
          <ContactButton
            studio="MONOGRAM"
            email="hello@monogram.studio"
            className={styles.contactCircle}
          >
            <Arrow diagonal />
            <span>Start a conversation</span>
          </ContactButton>
        </div>
        <div className={styles.footerInfo}>
          <a className={styles.emailLink} href="mailto:hello@monogram.studio">
            hello@monogram.studio
          </a>
          <p>
            London, United Kingdom
            <br />
            Collaborating worldwide
          </p>
          <a className={styles.backToTop} href="#top">
            Back to top{" "}
            <span>
              <Arrow />
            </span>
          </a>
        </div>
        <div className={styles.footerBottom}>
          <a
            href="#top"
            className={styles.footerLogo}
            aria-label="Monogram home"
          >
            MONOGRAM<span>®</span>
          </a>
          <span>&copy; {new Date().getFullYear()} Monogram Studio</span>
          <span>Considered. Not conventional.</span>
          <Link href="/" className={styles.allConcepts}>
            All concepts <Arrow diagonal />
          </Link>
        </div>
      </footer>
    </div>
  );
}
