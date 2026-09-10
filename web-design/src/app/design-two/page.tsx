import type { Metadata } from "next";
import DesignNav from "@/components/design-nav";
import { Arrow, Asterisk, HeroArtwork } from "./artwork";
import { ContactButton, Projects } from "./interactions";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "OFFSCRIPT - Good brands. Bad at blending in.",
  description:
    "An independent creative studio for brands with a point of view. Strategy, identity, digital, and a healthy disregard for the expected.",
};

const services = [
  {
    number: "01",
    title: "Find your point of view.",
    category: "STRATEGY",
    copy: "Before we make you look different, we find what makes you different. We ask the awkward questions, connect the unexpected dots, and give your brand something real to stand for.",
    items: [
      "Brand positioning",
      "Audience & culture",
      "Naming & verbal identity",
      "Brand architecture",
    ],
  },
  {
    number: "02",
    title: "Look like nobody else.",
    category: "IDENTITY",
    copy: "Not another logo in a sea of logos. We build distinctive, living identities with enough character to be recognised in a heartbeat and enough flexibility to go anywhere.",
    items: [
      "Visual identity",
      "Art direction",
      "Packaging",
      "Brand guidelines",
    ],
  },
  {
    number: "03",
    title: "Make every click count.",
    category: "DIGITAL",
    copy: "Digital experiences with a point of view, not just a template. We combine intuitive journeys, expressive design, and thoughtful development to make every interaction feel like you.",
    items: [
      "Digital strategy",
      "UX & UI design",
      "Web development",
      "Interaction design",
    ],
  },
  {
    number: "04",
    title: "Give them something to talk about.",
    category: "CAMPAIGNS",
    copy: "Ideas that leave the meeting room and enter the conversation. From a single bold poster to a full brand launch, we make work that earns attention rather than interrupting it.",
    items: [
      "Creative concepts",
      "Campaign systems",
      "Motion & content",
      "Brand launches",
    ],
  },
];

export default function DesignTwoPage() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <div className={styles.yellowCover}>
        <header className={`${styles.header} ${styles.container}`}>
          <a href="#top" className={styles.logo} aria-label="OFFSCRIPT home">
            OFFSCRIPT<span>*</span>
            <sup>®</sup>
          </a>
          <span className={styles.headerNote}>
            INDEPENDENT STUDIO.
            <br />
            UNCOMMON THINKING.
          </span>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#work">
              Work <span>04</span>
            </a>
            <a href="#studio">Studio</a>
            <a href="#services">What we do</a>
          </nav>
          <ContactButton />
        </header>
      </div>
      <main id="main">
        <div className={styles.yellowCover}>
          <section
            className={`${styles.hero} ${styles.container}`}
            aria-labelledby="hero-title"
          >
            <div className={styles.heroTopline}>
              <span>
                <i /> OPEN MINDS. OPEN FOR COLLABORATION.
              </span>
              <span>LONDON / EVERYWHERE</span>
            </div>
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <h1 id="hero-title">
                  Good brands.
                  <br />
                  Bad at
                  <br />
                  <span>blending in.</span>
                  <Asterisk className={styles.heroAsterisk} />
                </h1>
                <div className={styles.heroBottom}>
                  <p>
                    We&apos;re an independent creative studio.
                    <br />
                    Building bold brands, digital experiences,
                    <br className={styles.desktopBreak} /> and things you
                    can&apos;t scroll past.
                  </p>
                  <a
                    href="#work"
                    className={styles.roundLink}
                    aria-label="Explore our selected work"
                  >
                    <Arrow />
                  </a>
                </div>
              </div>
              <div className={styles.heroArt}>
                <div className={styles.artCoordinates}>
                  <span>FIG. 01</span>
                  <span>
                    A DIFFERENT
                    <br />
                    WAY OF THINKING.
                  </span>
                </div>
                <HeroArtwork />
                <div className={styles.artCaption}>
                  <span className={styles.crosshair}>+</span>
                  <span>
                    BREAK THE PATTERN.
                    <br />
                    MAKE YOUR OWN.
                  </span>
                  <span className={styles.artEdition}>OS / 2026</span>
                </div>
              </div>
            </div>
            <div className={styles.heroFoot}>
              <span>STRATEGY MEETS A HEALTHY DISREGARD FOR THE EXPECTED.</span>
              <a href="#work">
                SCROLL TO GO OFFSCRIPT <span aria-hidden="true">↓</span>
              </a>
            </div>
          </section>
        </div>

        <section
          id="work"
          className={`${styles.work} ${styles.container}`}
          aria-labelledby="work-title"
        >
          <div className={styles.sectionTop}>
            <span className={styles.eyebrow}>01 / OUT IN THE WORLD</span>
            <span className={styles.eyebrow}>GOOD PEOPLE. BOLD MOVES.</span>
          </div>
          <div className={styles.sectionHeading}>
            <h2 id="work-title">
              Less expected.
              <br />
              <span>More remembered.</span>
            </h2>
            <span className={styles.workCount}>(04)</span>
          </div>
          <Projects />
          <div className={styles.workEnd}>
            <span>DIFFERENT BRIEFS. SAME RESTLESS ENERGY.</span>
            <a href="#contact">
              Your project could be next <Arrow diagonal />
            </a>
          </div>
        </section>

        <section
          id="services"
          className={styles.services}
          aria-labelledby="services-title"
        >
          <div className={styles.container}>
            <div className={styles.sectionTop}>
              <span className={styles.eyebrow}>02 / WHAT WE BRING</span>
              <Asterisk className={styles.smallAsterisk} />
            </div>
            <div className={styles.servicesIntro}>
              <h2 id="services-title">
                Big picture.
                <br />
                Obsessive detail.
              </h2>
              <p>
                From the first &ldquo;what if&rdquo; to the final full stop.
                <br />
                We connect strategy, design, and a little
                <br className={styles.desktopBreak} /> instinct to move brands
                forward.
              </p>
            </div>
            <div className={styles.accordion}>
              {services.map((service, i) => (
                <details
                  key={service.number}
                  className={styles.service}
                  name="offscript-services"
                  open={i === 0}
                >
                  <summary>
                    <span className={styles.serviceNumber}>
                      {service.number}
                    </span>
                    <h3>{service.title}</h3>
                    <span className={styles.serviceCategory}>
                      {service.category}
                    </span>
                    <span className={styles.serviceToggle} aria-hidden="true" />
                  </summary>
                  <div className={styles.serviceContent}>
                    <p>{service.copy}</p>
                    <ul>
                      {service.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          id="studio"
          className={`${styles.studio} ${styles.container}`}
          aria-labelledby="studio-title"
        >
          <div className={styles.studioBadge} aria-hidden="true">
            <div className={styles.badgeTop}>INDEPENDENT BY DESIGN</div>
            <Asterisk />
            <div className={styles.badgeBottom}>DIFFERENT BY DEFAULT</div>
            <span>
              EST.
              <br />
              2018
            </span>
          </div>
          <div className={styles.studioCopy}>
            <span className={styles.eyebrow}>03 / A LITTLE ABOUT US</span>
            <h2 id="studio-title">
              Small studio.
              <br />
              No small ideas.
            </h2>
            <p>
              We&apos;re a close-knit crew of thinkers, makers, and &ldquo;what
              if&rdquo; people. Independently owned. Creatively restless.
              Allergic to business as usual.
            </p>
            <p>
              We work directly with ambitious people to build brands that mean
              something. No layers. No handoffs. Just good people, in it
              together, making the good stuff.
            </p>
            <a className={styles.textLink} href="#contact">
              Sound like your kind of people? <Arrow diagonal />
            </a>
          </div>
          <div className={styles.stats}>
            <div>
              <strong>
                08<span>+</span>
              </strong>
              <span>YEARS GOING OUR OWN WAY</span>
            </div>
            <div>
              <strong>42</strong>
              <span>BRANDS WITH A NEW POINT OF VIEW</span>
            </div>
            <div>
              <strong>
                100<span>%</span>
              </strong>
              <span>INDEPENDENT. ALWAYS.</span>
            </div>
          </div>
        </section>
      </main>
      <footer id="contact" className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.sectionTop}>
            <span className={styles.eyebrow}>04 / YOUR NEXT GOOD DECISION</span>
            <span className={styles.availability}>
              <i /> OPEN FOR THE RIGHT KIND OF TROUBLE
            </span>
          </div>
          <ContactButton variant="large" />
          <div className={styles.footerMiddle}>
            <p>
              Have a big ambition or a beautifully messy brief?
              <br />
              We&apos;d like to hear it.
            </p>
            <span>
              GOOD CHEMISTRY STARTS
              <br />
              WITH A SIMPLE HELLO.
            </span>
          </div>
          <div className={styles.footerBottom}>
            <a href="#top" className={styles.footerLogo}>
              OFFSCRIPT*
            </a>
            <span>
              © 2026 OFFSCRIPT STUDIO
              <br />
              AN INDEPENDENT STUDIO CONCEPT.
            </span>
            <a href="#top" className={styles.backTop}>
              BACK TO TOP <Arrow diagonal />
            </a>
          </div>
        </div>
      </footer>
      <DesignNav current={2} />
    </div>
  );
}
