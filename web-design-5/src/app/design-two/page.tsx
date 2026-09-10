import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ContactButton, ProjectLink } from "@/components/agency-interactions";
import styles from "./page.module.css";

const images = {
  hero: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=2200&q=85",
  morrow:
    "https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=1400&q=85",
  forme:
    "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1000&q=85",
  studio:
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=85",
};

export const metadata: Metadata = {
  title: "STILL | Less noise. More meaning.",
  description:
    "STILL is an independent creative studio shaping thoughtful brands and digital experiences. Brand strategy, visual identity, and digital design, with intention.",
  openGraph: {
    title: "STILL | Less noise. More meaning.",
    description:
      "An independent creative studio for brands with something meaningful to say.",
    images: [
      {
        url: images.hero,
        width: 2200,
        height: 1650,
        alt: "A warm, sunlit interior, the visual world of STILL",
      },
    ],
  },
};

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M3 12h17m-7-7 7 7-7 7"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

const services = [
  {
    number: "01",
    title: "Find your meaning.",
    category: "Brand strategy",
    description:
      "Before we make anything, we make sense of things. Through open conversations, research, and a little healthy questioning, we uncover what makes your brand matter and give it a clear direction.",
    deliverables: [
      "Positioning & purpose",
      "Audience insight",
      "Naming & tone of voice",
    ],
  },
  {
    number: "02",
    title: "Make it felt.",
    category: "Visual identity",
    description:
      "We turn a clear idea into a distinctive visual world. From the smallest typographic detail to the bigger picture, we create identities with enough character to be remembered and enough clarity to last.",
    deliverables: [
      "Identity systems",
      "Art direction & packaging",
      "Brand guidelines",
    ],
  },
  {
    number: "03",
    title: "Bring it to life.",
    category: "Digital experiences",
    description:
      "Considered design, made to be used. We build intuitive websites and digital experiences that balance expression with function, making every interaction feel like a natural extension of your brand.",
    deliverables: [
      "Website design & development",
      "E-commerce",
      "Digital design systems",
    ],
  },
];

export default function StillPage() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="STILL, back to top">
          <span className={styles.wordmark}>
            STILL<span className={styles.brandDot}>.</span>
          </span>
          <span className={styles.brandDescription}>
            Independent
            <br />
            creative studio
          </span>
        </a>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#work">
            Selected work <sup>02</sup>
          </a>
          <a href="#studio">The studio</a>
          <a href="#approach">Our approach</a>
        </nav>
        <ContactButton
          studio="STILL"
          email="hello@still.studio"
          className={styles.headerContact}
        >
          Let&apos;s talk <Arrow diagonal />
        </ContactButton>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroHeading}>
            <p className={styles.eyebrow}>
              <span className={styles.smallStar} aria-hidden="true">
                *
              </span>{" "}
              Thoughtful by nature. Distinctive by design.
            </p>
            <h1 id="hero-heading">
              Less noise.
              <br />
              More <em>meaning.</em>
            </h1>
            <div className={styles.heroBottom}>
              <p>
                We build brands and digital experiences
                <br className={styles.desktopBreak} /> that feel as good as they
                look.
              </p>
              <span className={styles.heroNote}>
                A little less.
                <br />A little more considered.
              </span>
              <a href="#work" className={styles.exploreLink}>
                <span>Explore our work</span>
                <span className={styles.downArrow}>
                  <Arrow />
                </span>
              </a>
            </div>
          </div>

          <figure>
            <div className={styles.heroImage}>
              <Image
                src={images.hero}
                alt="Afternoon light falling across natural materials, greenery, and a thoughtfully composed living space"
                fill
                unoptimized
                preload
                sizes="(max-width: 700px) calc(100vw - 48px), (max-width: 1600px) 92vw, 1472px"
              />
              <span className={styles.imageCorner} aria-hidden="true" />
              <div className={styles.imageAnnotation}>
                <span className={styles.annotationNumber}>Fig. 01</span>
                <span>
                  A little space.
                  <br />A different perspective.
                </span>
              </div>
            </div>
            <figcaption className={styles.heroCaption}>
              <span>Clarity is a beautiful thing.</span>
              <span>
                London, UK <span aria-hidden="true">/</span> Working everywhere
              </span>
            </figcaption>
          </figure>
        </section>

        <section
          className={styles.section}
          id="work"
          aria-labelledby="work-heading"
        >
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>
              <span className={styles.sectionNumber}>01 /</span> Selected work
            </p>
            <span className={styles.quietLabel}>
              A few things we&apos;ve put into the world
            </span>
          </div>
          <div className={styles.workIntro}>
            <h2 id="work-heading" className={styles.heading}>
              Different stories.
              <br />
              The same <em>intention.</em>
            </h2>
            <p>
              No signature style. No one-size-fits-all.
              <br />
              Just the right expression of who you are.
            </p>
          </div>

          <div className={styles.projectGrid}>
            <article className={styles.project}>
              <ProjectLink
                title="Morrow"
                category="Home & lifestyle"
                description="Objects worth making room for. We helped Morrow, an independent homewares brand, find a quieter voice in a crowded category. A warm, editorial identity celebrates the simple rituals and considered objects that make an ordinary day feel a little different."
                services={[
                  "Brand strategy",
                  "Visual identity",
                  "Packaging",
                  "E-commerce design",
                ]}
                outcome="One coherent brand world, from the first unboxing to the online store. An expressive identity and practical design toolkit give the Morrow team the confidence to grow without losing their personal touch."
                image={images.morrow}
                className={styles.projectButton}
              >
                <span
                  className={`${styles.projectImage} ${styles.morrowImage}`}
                >
                  <Image
                    src={images.morrow}
                    alt="Sculptural white vases with blossom branches on a pale wooden table, styled for Morrow homewares"
                    fill
                    unoptimized
                    sizes="(max-width: 700px) calc(100vw - 48px), (max-width: 1600px) 49vw, 782px"
                  />
                  <span className={styles.morrowBrand} aria-hidden="true">
                    morrow<span>.</span>
                  </span>
                  <span className={styles.morrowTagline}>
                    GOOD THINGS. EVERY DAY.
                  </span>
                  <span className={styles.projectImageLabel}>
                    A considered collection for everyday living.
                  </span>
                  <span className={styles.projectHover}>
                    Discover the story <Arrow diagonal />
                  </span>
                </span>
                <span className={styles.projectDetails}>
                  <span>
                    <span className={styles.projectTitle}>Morrow</span>
                    <span className={styles.projectCategory}>
                      Brand strategy & identity, e-commerce
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow diagonal />
                  </span>
                </span>
              </ProjectLink>
            </article>

            <article className={`${styles.project} ${styles.secondProject}`}>
              <ProjectLink
                title="Forme"
                category="Contemporary lighting"
                description="A new light on the everyday. Forme creates purposeful lighting for real homes. We developed a confident but approachable identity, pairing sculptural typography with an understated palette and art direction that lets the products do the talking."
                services={[
                  "Positioning",
                  "Naming",
                  "Visual identity",
                  "Art direction",
                  "Website design",
                ]}
                outcome="A complete launch identity and digital flagship that make a technical product feel human. A flexible editorial system connects the product catalogue, campaign imagery, and a straightforward shopping experience."
                image={images.forme}
                className={styles.projectButton}
              >
                <span className={`${styles.projectImage} ${styles.formeImage}`}>
                  <Image
                    src={images.forme}
                    alt="A sculptural black reading lamp against a soft sage wall, art direction for Forme"
                    fill
                    unoptimized
                    sizes="(max-width: 700px) 74vw, (max-width: 1600px) 36vw, 573px"
                  />
                  <span className={styles.formeBrand} aria-hidden="true">
                    forme
                  </span>
                  <span className={styles.formeTagline}>
                    A NEW LIGHT
                    <br />
                    ON THE EVERYDAY.
                  </span>
                  <span className={styles.projectHover}>
                    Discover the story <Arrow diagonal />
                  </span>
                </span>
                <span className={styles.projectDetails}>
                  <span>
                    <span className={styles.projectTitle}>Forme</span>
                    <span className={styles.projectCategory}>
                      Positioning, identity & digital experience
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow diagonal />
                  </span>
                </span>
              </ProjectLink>
            </article>
          </div>
          <p className={styles.workClosing}>
            Good work begins with a good conversation.{" "}
            <a href="#contact">
              Let&apos;s have one <Arrow diagonal />
            </a>
          </p>
        </section>

        <section
          className={styles.studio}
          id="studio"
          aria-labelledby="studio-heading"
        >
          <div className={styles.studioInner}>
            <div className={styles.studioCopy}>
              <p className={styles.eyebrow}>
                <span className={styles.sectionNumber}>02 /</span> The studio
              </p>
              <h2 id="studio-heading" className={styles.heading}>
                Small on purpose.
                <br />
                Thoughtful
                <br />
                by <em>nature.</em>
              </h2>
              <div className={styles.studioBody}>
                <p>
                  STILL is an independent creative studio built around a simple
                  belief: the most meaningful design comes from paying
                  attention.
                </p>
                <p>
                  To your story. To your audience. To the details others might
                  miss. We bring strategy, identity, and digital design together
                  to help good businesses become brands people feel something
                  for.
                </p>
                <p>
                  We keep our team small and our minds open. You work directly
                  with the people doing the thinking and the making. No layers.
                  No lost-in-translation. Just a genuine partnership, from the
                  first conversation to the final detail.
                </p>
                <a href="#approach" className={styles.textLink}>
                  A look at how we work <Arrow diagonal />
                </a>
              </div>
            </div>
            <figure className={styles.studioFigure}>
              <div className={styles.studioImage}>
                <Image
                  src={images.studio}
                  alt="A quiet, light-filled workspace with a long table, natural wood, and a simple arrangement of foliage"
                  fill
                  unoptimized
                  sizes="(max-width: 700px) 78vw, (max-width: 1600px) 41vw, 662px"
                />
              </div>
              <figcaption>
                <span>Room to think. Space to create.</span>
                <span>Est. 2018</span>
              </figcaption>
              <div className={styles.studioSeal} aria-hidden="true">
                <span>Always</span>
                <span className={styles.sealStar}>*</span>
                <span>with intention</span>
              </div>
            </figure>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.approach}`}
          id="approach"
          aria-labelledby="approach-heading"
        >
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>
              <span className={styles.sectionNumber}>03 /</span> Our approach
            </p>
            <span className={styles.quietLabel}>
              Clear thinking. Considered making.
            </span>
          </div>
          <div className={styles.approachIntro}>
            <h2 id="approach-heading" className={styles.heading}>
              From what you stand for
              <br />
              to how you <em>show up.</em>
            </h2>
            <p>
              Three connected disciplines.
              <br />
              One considered point of view.
            </p>
          </div>
          <div className={styles.services}>
            {services.map((service) => (
              <details
                key={service.number}
                className={styles.service}
                name="still-services"
              >
                <summary>
                  <span className={styles.serviceNumber}>{service.number}</span>
                  <span className={styles.serviceTitle}>{service.title}</span>
                  <span className={styles.serviceCategory}>
                    {service.category}
                  </span>
                  <span className={styles.serviceToggle} aria-hidden="true">
                    <span />
                    <span />
                  </span>
                </summary>
                <div className={styles.serviceContent}>
                  <p>{service.description}</p>
                  <ul>
                    {service.deliverables.map((deliverable) => (
                      <li key={deliverable}>{deliverable}</li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
          <div className={styles.approachFootnote}>
            <span>Built around you, not the other way around.</span>
            <span>Independent in spirit. Collaborative by design.</span>
          </div>
        </section>

        <section
          className={styles.testimonial}
          aria-labelledby="testimonial-heading"
        >
          <p className={styles.eyebrow} id="testimonial-heading">
            A word from the other side of the table
          </p>
          <span className={styles.quoteMark} aria-hidden="true">
            &ldquo;
          </span>
          <figure>
            <blockquote>
              They didn&apos;t just understand our brand.
              <br className={styles.desktopBreak} /> They saw what it{" "}
              <em>could become.</em>
              <br /> And then made it feel so beautifully us.
            </blockquote>
            <figcaption>
              <span className={styles.testimonialLine} />
              <span>
                Sarah Mitchell<span>Founder, Morrow</span>
              </span>
            </figcaption>
          </figure>
          <span className={styles.testimonialIndex}>01 / 01</span>
        </section>
      </main>

      <footer className={styles.footer} id="contact">
        <div className={styles.footerTop}>
          <p className={styles.eyebrow}>Something on your mind?</p>
          <span className={styles.availability}>
            <span /> Open for considered collaborations
          </span>
        </div>
        <div className={styles.contactHeading}>
          <h2 className={styles.heading}>
            Let&apos;s make
            <br />
            something <em>matter.</em>
          </h2>
          <ContactButton
            studio="STILL"
            email="hello@still.studio"
            className={styles.contactCircle}
          >
            <Arrow diagonal />
            <span>Start a conversation</span>
          </ContactButton>
        </div>
        <div className={styles.contactBottom}>
          <a className={styles.emailLink} href="mailto:hello@still.studio">
            hello@still.studio <Arrow diagonal />
          </a>
          <p>
            A new beginning. A change of direction.
            <br />
            Or just a good question. We&apos;re listening.
          </p>
        </div>
        <div className={styles.footerRule} />
        <div className={styles.footerBottom}>
          <a
            href="#top"
            className={styles.footerWordmark}
            aria-label="STILL, back to top"
          >
            STILL.
          </a>
          <span className={styles.copyright}>
            &copy; {new Date().getFullYear()} STILL Studio
          </span>
          <Link href="/" className={styles.conceptsLink}>
            All concepts <Arrow diagonal />
          </Link>
          <a href="#top" className={styles.backTop}>
            Back to the quiet{" "}
            <span>
              <Arrow />
            </span>
          </a>
        </div>
      </footer>
    </div>
  );
}
