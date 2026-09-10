import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ContactButton, ProjectLink } from "@/components/agency-interactions";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FORMA | Independent Minds. Unmistakable Brands.",
  description:
    "An independent creative studio building brands, digital experiences, and ideas that move the world forward. London-based. Globally minded.",
};

const building =
  "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1400&q=85";
const coast =
  "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1200&q=85";
const studio =
  "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1400&q=85";

function Arrow({ diagonal = true }: { diagonal?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h16m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Asterisk({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="44"
      height="44"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="18">
        <path d="M50 0v100M0 50h100M15 15l70 70M15 85l70-70" />
      </g>
    </svg>
  );
}

const projects = [
  {
    title: "Daylight",
    category: "Strategy & identity",
    description:
      "Better energy, without the compromise. We partnered with a new generation of drinks makers to give their plant-powered energy drink a confident, optimistic place in a very crowded fridge. A bold name, a sun-soaked identity, and packaging with nothing to hide.",
    services: [
      "Brand positioning",
      "Naming & voice",
      "Visual identity",
      "Packaging design",
      "Launch campaign",
    ],
    outcome:
      "A complete launch system across three flavors, retail packaging, and a direct-to-consumer digital experience.",
  },
  {
    title: "Noma Living",
    category: "Brand & digital",
    description:
      "A fresh perspective on the places we call home. For Noma Living, we created a brand that puts human experience before square footage. Architectural clarity meets everyday warmth in a flexible identity and an intuitive property discovery platform.",
    services: [
      "Brand strategy",
      "Visual identity",
      "Art direction",
      "UX & UI design",
      "Development",
    ],
    outcome:
      "One connected brand experience across a growing portfolio of twelve residential spaces and a new digital home.",
    image: building,
  },
  {
    title: "Offshore",
    category: "Identity & experience",
    description:
      "A different current in independent travel. Offshore connects curious people with extraordinary coastal places. We helped its founders translate a love for the sea into a distinctive brand world, from the booking experience to the welcome waiting in every room.",
    services: [
      "Positioning",
      "Brand identity",
      "Website design",
      "Editorial design",
    ],
    outcome:
      "A flexible identity and storytelling-led digital platform, ready to introduce six remarkable destinations to the world.",
    image: coast,
  },
];

export default function FormaPage() {
  return (
    <div className={styles.page} id="top">
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.header}>
        <a href="#top" className={styles.logo} aria-label="FORMA home">
          forma
          <span className={styles.logoStar}>
            <Asterisk />
          </span>
          <sup>®</sup>
        </a>
        <span className={styles.navIntro}>
          Independent minds.
          <br />
          Unmistakable brands.
        </span>
        <nav aria-label="Main navigation">
          <a href="#work">
            Our work <sup>03</sup>
          </a>
          <a href="#studio">The studio</a>
          <a href="#expertise">Expertise</a>
        </nav>
        <ContactButton studio="FORMA" className={styles.navCta}>
          Let&apos;s talk <Arrow />
        </ContactButton>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>
              <i /> SMALL STUDIO. BIG PICTURE.
            </span>
            <h1 id="hero-title">
              Good ideas.
              <br />
              Great design.
              <br />
              <span>Real impact.</span>
            </h1>
            <p>
              We turn bold ambitions into brands that matter.
              <br className={styles.desktopBreak} /> Strategy, identity, and
              digital experiences.
              <br className={styles.desktopBreak} /> All made to move you
              forward.
            </p>
            <a href="#work" className={styles.pill}>
              Explore our work <Arrow diagonal={false} />
            </a>
            <div className={styles.heroFoot}>
              <span>LONDON & EVERYWHERE</span>
              <span>
                SCROLL TO EXPLORE <span aria-hidden="true">↓</span>
              </span>
            </div>
          </div>
          <div className={styles.heroArt}>
            <span className={styles.artLabel}>A NEW PERSPECTIVE, BY FORMA</span>
            <div className={styles.nomaBook}>
              <div className={styles.bookTop}>
                <span>NOMA</span>
                <span>
                  LIVING
                  <br />
                  DIFFERENTLY.
                </span>
              </div>
              <div className={styles.bookImage}>
                <Image
                  src={building}
                  alt="Sculptural white architecture featured in the Noma Living brand identity"
                  fill
                  preload
                  sizes="(max-width: 700px) 80vw, 40vw"
                  unoptimized
                />
                <span>
                  A better kind
                  <br />
                  of ordinary.
                </span>
              </div>
              <div className={styles.bookBottom}>
                <span>SPACES FOR LIFE.</span>
                <span>01 / 2026</span>
              </div>
            </div>
            <div className={styles.orangeCard} aria-hidden="true">
              <Asterisk />
              <span>
                Make
                <br />
                your mark.
              </span>
              <small>FORMA STUDIO / EST. 2018</small>
            </div>
            <div className={styles.artCaption}>
              <span>FEATURED PROJECT</span>
              <ProjectLink {...projects[1]} className={styles.featureLink}>
                Noma Living <Arrow />
              </ProjectLink>
            </div>
            <span className={styles.artCross} aria-hidden="true">
              +
            </span>
          </div>
        </section>

        <section
          className={styles.partners}
          aria-label="Selected collaborators"
        >
          <span>
            GOOD COMPANY.
            <br />
            GREAT COLLABORATIONS.
          </span>
          <div>
            <b className={styles.partnerNoma}>NOMA</b>
            <b className={styles.partnerDaylight}>daylight.</b>
            <b className={styles.partnerArc}>arc&apos;teryx</b>
            <b className={styles.partnerOffshore}>offshore®</b>
            <b className={styles.partnerCommon}>
              COMMON
              <br />
              GROUND
            </b>
          </div>
        </section>

        <section className={styles.work} id="work">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>01 / SELECTED WORK</span>
              <h2>
                Different challenges.
                <br />
                Same restless curiosity.
              </h2>
            </div>
            <span className={styles.sectionNote}>
              A few things we&apos;ve put into the world.
              <br />
              Built together. Made to make a difference.
            </span>
          </div>
          <div className={styles.projectGrid}>
            <article className={styles.project}>
              <ProjectLink
                {...projects[0]}
                className={`${styles.projectVisual} ${styles.daylightArt}`}
              >
                <span className={styles.daylightBackdrop}>
                  RISE &<br />
                  SHINE.
                </span>
                <span className={styles.drinkCan}>
                  <span className={styles.canTop} />
                  <span className={styles.canKicker}>
                    A BRIGHTER KIND OF ENERGY
                  </span>
                  <span className={styles.canBrand}>
                    day
                    <br />
                    light<span>.</span>
                  </span>
                  <span className={styles.canSun} />
                  <span className={styles.canFlavor}>
                    BLOOD ORANGE
                    <br />
                    <small>GOOD ENERGY. NATURALLY.</small>
                  </span>
                  <span className={styles.canBottom} />
                </span>
                <span className={styles.projectRound}>
                  <Arrow />
                </span>
                <span className={styles.drinkLabel}>
                  MORE SUNSHINE.
                  <br />
                  LESS OF THE OTHER STUFF.
                </span>
              </ProjectLink>
              <div className={styles.projectCaption}>
                <h3>Daylight</h3>
                <span>Brand strategy / Identity / Packaging</span>
                <span>2026</span>
              </div>
            </article>
            <article className={styles.project}>
              <ProjectLink
                {...projects[1]}
                className={`${styles.projectVisual} ${styles.nomaArt}`}
              >
                <Image
                  src={building}
                  alt="Clean architectural lines against a pale blue sky"
                  fill
                  sizes="(max-width: 700px) 100vw, 50vw"
                  unoptimized
                />
                <span className={styles.nomaOverlay}>
                  NOMA<span>SPACE TO BE YOURSELF.</span>
                </span>
                <span className={styles.projectRound}>
                  <Arrow />
                </span>
              </ProjectLink>
              <div className={styles.projectCaption}>
                <h3>Noma Living</h3>
                <span>Strategy / Identity / Digital</span>
                <span>2026</span>
              </div>
            </article>
            <article className={`${styles.project} ${styles.wideProject}`}>
              <ProjectLink
                {...projects[2]}
                className={`${styles.projectVisual} ${styles.offshoreArt}`}
              >
                <Image
                  src={coast}
                  alt="Ocean waves rolling onto an unspoiled coast"
                  fill
                  sizes="100vw"
                  unoptimized
                />
                <span className={styles.offshoreTitle}>
                  offshore<span>Go a little further. Feel a little more.</span>
                </span>
                <span className={styles.offshoreNote}>
                  A DIFFERENT CURRENT.
                  <br />
                  AN INDEPENDENT SPIRIT.
                </span>
                <span className={styles.projectRound}>
                  <Arrow />
                </span>
              </ProjectLink>
              <div className={styles.projectCaption}>
                <h3>Offshore</h3>
                <span>Positioning / Identity / Digital experience</span>
                <span>2025</span>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.studio} id="studio">
          <div className={styles.studioTop}>
            <span className={styles.eyebrow}>02 / THE WAY WE SEE IT</span>
            <h2>
              The best work starts
              <br />
              with <span>better questions.</span>
            </h2>
          </div>
          <div className={styles.studioGrid}>
            <div className={styles.studioImage}>
              <Image
                src={studio}
                alt="The light-filled FORMA studio with shared worktables and green plants"
                fill
                sizes="(max-width: 700px) 100vw, 50vw"
                unoptimized
              />
              <span>OUR SPACE. YOUR NEXT BIG IDEA.</span>
            </div>
            <div className={styles.studioCopy}>
              <Asterisk />
              <h3>Not bigger. Just closer.</h3>
              <p>
                We&apos;re a tight-knit team of strategists, designers, and
                digital thinkers. Independently owned, endlessly curious, and
                happiest when we&apos;re making something that hasn&apos;t been
                done before.
              </p>
              <p>
                No layers. No hand-offs. You work directly with the people doing
                the thinking and making. We get close to your business,
                challenge the obvious, and create work that feels unmistakably
                you.
              </p>
              <div className={styles.stats}>
                <div>
                  <b>08</b>
                  <span>YEARS OF MAKING A MARK</span>
                </div>
                <div>
                  <b>12</b>
                  <span>INDEPENDENT MINDS</span>
                </div>
                <div>
                  <b>40+</b>
                  <span>BRANDS MOVED FORWARD</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.expertise} id="expertise">
          <div>
            <span className={styles.eyebrow}>03 / WHAT WE BRING</span>
            <h2>
              From the first
              <br />
              why to the
              <br />
              <span>what&apos;s next.</span>
            </h2>
            <p>
              Clear thinking. Considered craft.
              <br />
              Everything your next chapter needs.
            </p>
          </div>
          <div className={styles.serviceList}>
            {[
              {
                n: "01",
                title: "Strategy",
                line: "Find your difference.",
                text: "We turn complexity into clarity. Research, honest conversations, and a fresh perspective uncover the space only your brand can own.",
                tags: "Positioning / Research / Naming / Brand architecture",
              },
              {
                n: "02",
                title: "Identity",
                line: "Make it unmistakable.",
                text: "A distinctive visual and verbal world, built around one strong idea. Flexible enough to grow with you. Consistent enough to be recognized anywhere.",
                tags: "Visual identity / Tone of voice / Packaging / Guidelines",
              },
              {
                n: "03",
                title: "Digital",
                line: "Bring your world to life.",
                text: "Beautiful experiences that work as good as they look. We connect considered design with thoughtful development, making every interaction count.",
                tags: "UX & UI / Websites / E-commerce / Development",
              },
              {
                n: "04",
                title: "Art Direction",
                line: "Make people feel something.",
                text: "A point of view you can see and feel. We bring together photography, motion, and storytelling to create a complete, compelling brand world.",
                tags: "Photography / Film / Campaigns / Motion",
              },
            ].map((service) => (
              <details key={service.n} className={styles.service}>
                <summary>
                  <span>{service.n}</span>
                  <h3>{service.title}</h3>
                  <span className={styles.servicePlus} aria-hidden="true">
                    +
                  </span>
                </summary>
                <div>
                  <h4>{service.line}</h4>
                  <p>{service.text}</p>
                  <span>{service.tags}</span>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.testimonial}>
          <span className={styles.eyebrow}>KIND WORDS. REAL PARTNERSHIPS.</span>
          <blockquote>
            &ldquo;They didn&apos;t just understand our brief.
            <br />
            They saw what our brand <span>could become.</span>&rdquo;
          </blockquote>
          <div>
            <span className={styles.avatar}>JL</span>
            <span>
              <b>James Liu</b>
              <br />
              Founder, Noma Living
            </span>
            <span className={styles.quoteRating}>
              A SHARED AMBITION.
              <br />
              AN EXCEPTIONAL RESULT.
            </span>
          </div>
        </section>

        <section className={styles.contact} id="contact">
          <div className={styles.contactTop}>
            <span className={styles.eyebrow}>
              <i /> OPEN FOR GOOD CONVERSATIONS
            </span>
            <span>YOUR NEXT CHAPTER STARTS HERE.</span>
          </div>
          <ContactButton studio="FORMA" className={styles.contactTitle}>
            Let&apos;s make
            <br />a difference.
            <span className={styles.contactArrow}>
              <Arrow />
            </span>
          </ContactButton>
          <div className={styles.contactBottom}>
            <p>
              Got an ambitious idea?
              <br />
              We&apos;re already curious.
            </p>
            <a href="mailto:hello@forma.studio">
              hello@forma.studio <Arrow />
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <a href="#top" className={styles.footerLogo}>
          forma
          <Asterisk />
        </a>
        <span>
          INDEPENDENT BY DESIGN.
          <br />
          LONDON & EVERYWHERE.
        </span>
        <Link href="/">
          All concepts <Arrow />
        </Link>
        <span>© FORMA 2026</span>
        <a href="#top" aria-label="Back to top">
          BACK TO TOP ↑
        </a>
      </footer>
    </div>
  );
}
