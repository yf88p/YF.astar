import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ContactButton, ProjectLink } from "@/components/agency-interactions";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "OFFSCRIPT | Good Design. Bad Influence.",
  description:
    "An independent creative studio for brands that refuse to blend in. Strategy, identity, digital and campaigns at the intersection of music, culture and technology.",
};

function Arrow({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 26 26 6M6 6h20v20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Orbital() {
  return (
    <svg
      className={styles.orbital}
      viewBox="0 0 720 390"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="offscript-dots"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2.5" cy="2.5" r="1.55" fill="#f5f5ed" />
        </pattern>
        <radialGradient id="offscript-light" cx=".35" cy=".17" r=".85">
          <stop stopColor="white" />
          <stop offset=".33" stopColor="white" stopOpacity=".95" />
          <stop offset=".66" stopColor="white" stopOpacity=".15" />
          <stop offset="1" stopColor="white" stopOpacity=".8" />
        </radialGradient>
        <mask id="offscript-shading">
          <rect
            x="50"
            y="35"
            width="620"
            height="320"
            fill="url(#offscript-light)"
          />
        </mask>
        <clipPath id="offscript-ring">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M650 205a290 148 0 1 0-580 0 290 148 0 1 0 580 0Zm-156-25a134 55 0 1 1-268 0 134 55 0 1 1 268 0Z"
          />
        </clipPath>
      </defs>
      <g transform="rotate(-18 360 195)">
        <path
          fillRule="evenodd"
          d="M650 205a290 148 0 1 0-580 0 290 148 0 1 0 580 0Zm-156-25a134 55 0 1 1-268 0 134 55 0 1 1 268 0Z"
          fill="#11120d"
        />
        <g clipPath="url(#offscript-ring)">
          <rect
            x="50"
            y="35"
            width="620"
            height="320"
            fill="url(#offscript-dots)"
            mask="url(#offscript-shading)"
          />
          {Array.from({ length: 15 }, (_, index) => (
            <ellipse
              key={index}
              cx="360"
              cy={196 + index * 2.2}
              rx={146 + index * 9.5}
              ry={63 + index * 5.2}
              stroke="#11120d"
              strokeWidth={1.2 + index * 0.1}
            />
          ))}
          <ellipse
            cx="360"
            cy="173"
            rx="141"
            ry="59"
            stroke="#f5f5ed"
            strokeWidth="2"
          />
        </g>
        <ellipse
          cx="360"
          cy="205"
          rx="290"
          ry="148"
          stroke="#11120d"
          strokeWidth="2"
        />
      </g>
      <ellipse
        cx="360"
        cy="201"
        rx="347"
        ry="87"
        transform="rotate(-28 360 201)"
        stroke="#11120d"
        strokeWidth="1.1"
      />
      <circle cx="635" cy="46" r="8" fill="#11120d" />
      <path
        d="M666 269v22m-11-11h22M62 68v16m-8-8h16"
        stroke="#11120d"
        strokeWidth="1"
      />
    </svg>
  );
}

const projects = [
  {
    title: "Afterhours",
    category: "Identity",
    sector: "Music & nightlife",
    year: "2026",
    number: "01",
    description:
      "A new identity for the hours that belong to us. We helped an independent electronic music festival turn its underground spirit into a living visual system, from the first lineup announcement to the last light on the dance floor.",
    services: [
      "Brand strategy",
      "Visual identity",
      "Custom typography",
      "Motion system",
      "Festival wayfinding",
    ],
    outcome:
      "One unmistakable identity, built to move across 3 stages, 40 artists and every late-night touchpoint.",
    art: "afterhours",
  },
  {
    title: "Form Futures",
    category: "Digital",
    sector: "Architecture & culture",
    year: "2026",
    number: "02",
    description:
      "Architecture is a conversation about what comes next. We built an editorial-first digital home for Form Futures, connecting ambitious spatial thinking with a new generation of architects, makers and curious minds.",
    services: [
      "Digital strategy",
      "UX & UI design",
      "Art direction",
      "Web development",
      "Editorial system",
    ],
    outcome:
      "A fully accessible publishing platform that brings projects, perspectives and events into one connected experience.",
    image:
      "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=85",
    art: "form",
  },
  {
    title: "No Signal",
    category: "Campaign",
    sector: "Live music & culture",
    year: "2025",
    number: "03",
    description:
      "Less scrolling. More feeling. A culture-first campaign for No Signal that invited a generation to put their phones away and get back into the crowd. Raw photography and a deliberately loud typographic voice carried the message.",
    services: [
      "Campaign concept",
      "Creative direction",
      "Photography direction",
      "Social & outdoor",
      "Motion design",
    ],
    outcome:
      "A single creative platform adapted into 24 campaign assets, from street-level posters to stage-sized screens.",
    image:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=85",
    art: "signal",
  },
  {
    title: "Otherkind",
    category: "Identity",
    sector: "Technology & community",
    year: "2025",
    number: "04",
    description:
      "Technology with a little more humanity. We shaped the positioning, name and identity for a community platform making room for different perspectives. A playful, flexible system that celebrates what makes each of us other.",
    services: [
      "Positioning & naming",
      "Brand identity",
      "Illustration",
      "Brand guidelines",
      "Launch art direction",
    ],
    outcome:
      "A complete brand toolkit that gives an independent team the freedom to launch, grow and stay unmistakably themselves.",
    art: "otherkind",
  },
];

const capabilities = [
  {
    title: "Find your edge.",
    discipline: "Strategy",
    text: "Before we make a mark, we find what matters. We get under the skin of your business, your audience and the culture around them. Then we find the territory only you can own.",
    services: [
      "Brand positioning",
      "Audience & cultural insight",
      "Naming",
      "Brand architecture",
      "Tone of voice",
    ],
  },
  {
    title: "Look like nobody else.",
    discipline: "Identity",
    text: "Not another logo in a sea of sameness. We build distinctive visual worlds with a point of view, and the tools to keep that point of view intact as your brand grows.",
    services: [
      "Visual identity",
      "Art direction",
      "Typography",
      "Motion systems",
      "Brand guidelines",
    ],
  },
  {
    title: "Break the internet. Nicely.",
    discipline: "Digital",
    text: "Digital experiences that feel as good as they work. We bring strategy, design and development together to build fast, accessible websites with personality in every interaction.",
    services: [
      "Websites & platforms",
      "UX & UI design",
      "Creative development",
      "E-commerce",
      "Design systems",
    ],
  },
  {
    title: "Give them something to feel.",
    discipline: "Campaign",
    text: "Good campaigns don't interrupt culture. They contribute to it. We make ideas that travel, with the craft and consistency to show up everywhere without blending in anywhere.",
    services: [
      "Creative concepts",
      "Integrated campaigns",
      "Content & film",
      "Social & outdoor",
      "Launch experiences",
    ],
  },
];

export default function DesignThreePage() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <div className={styles.acidTop}>
        <header className={styles.header}>
          <a href="#top" className={styles.logo} aria-label="OFFSCRIPT home">
            OFFSCRIPT<span>&reg;</span>
          </a>
          <span className={styles.headerNote}>
            Independent minds.
            <br />
            Collective trouble.
          </span>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#work">
              Work <span>04</span>
            </a>
            <a href="#studio">Studio</a>
            <a href="#capabilities">What we do</a>
          </nav>
          <ContactButton
            studio="OFFSCRIPT"
            email="hello@offscript.studio"
            className={styles.headerContact}
          >
            Let&apos;s talk <Arrow />
          </ContactButton>
        </header>

        <main id="main">
          <section className={styles.hero} aria-labelledby="hero-heading">
            <div className={styles.heroEyebrow}>
              <span>
                <i className={styles.statusDot} /> Independent creative studio
              </span>
              <span>London. Everywhere.</span>
              <span className={styles.heroEdition}>
                Est. 2014 / Still restless
              </span>
            </div>
            <div className={styles.heroComposition}>
              <h1 id="hero-heading" className={styles.heroTitle}>
                <span>GOOD DESIGN.</span>
                <span className={styles.badLine}>
                  BAD
                  <span className={styles.smallAsterisk} aria-hidden="true">
                    *
                  </span>
                </span>
                <span>INFLUENCE.</span>
              </h1>
              <div className={styles.orbitalWrap}>
                <Orbital />
                <span className={styles.orbitalLabel}>
                  FIG. 01 / A DIFFERENT ORBIT
                </span>
              </div>
              <svg
                className={styles.heroArrow}
                viewBox="0 0 140 140"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 32 33 11l71 71V32h29v100H33v-29h49L12 32Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className={styles.heroBottom}>
              <p>
                We build brands that move culture.
                <br />
                Not just fit into it.
              </p>
              <p className={styles.heroAside}>
                Strategy. Identity. Digital. Campaigns.
                <br />
                For the ones who see things differently.
              </p>
              <a href="#work" className={styles.workJump}>
                Meet your new bad influence <Arrow />
              </a>
            </div>
          </section>

          <div
            className={styles.ticker}
            role="img"
            aria-label="Less expected. More remembered."
          >
            <div aria-hidden="true">
              <span>LESS EXPECTED.</span>
              <span className={styles.tickerStar}>&#10035;</span>
              <span>MORE REMEMBERED.</span>
              <span className={styles.tickerStar}>&#10035;</span>
              <span>LESS EXPECTED.</span>
              <span className={styles.tickerStar}>&#10035;</span>
              <span>MORE REMEMBERED.</span>
              <span className={styles.tickerStar}>&#10035;</span>
            </div>
          </div>

          <section
            id="work"
            className={styles.work}
            aria-labelledby="work-heading"
          >
            <div className={styles.sectionLabel}>
              <span>[ 01 / SELECTED WORK ]</span>
              <span>PROOF, NOT PROMISES.</span>
            </div>
            <div className={styles.workHeading}>
              <h2 id="work-heading">
                OUT IN
                <br />
                <span>THE WORLD.</span>
                <sup>(04)</sup>
              </h2>
              <p>
                Different worlds. Same instinct.
                <br />A selection of things we&apos;ve helped
                <br className={styles.desktopBreak} /> make impossible to
                ignore.
              </p>
            </div>

            <div className={styles.workIndex}>
              <fieldset className={styles.filters}>
                <legend className={styles.srOnly}>
                  Filter selected work by discipline
                </legend>
                {(["All", "Identity", "Digital", "Campaign"] as const).map(
                  (category, index) => (
                    <label key={category} className={styles.filter}>
                      <input
                        type="radio"
                        name="offscript-category"
                        value={category.toLowerCase()}
                        defaultChecked={index === 0}
                        aria-controls="offscript-projects"
                      />
                      <span>
                        {category}
                        <sup>
                          {index === 0 ? "04" : index === 1 ? "02" : "01"}
                        </sup>
                      </span>
                    </label>
                  ),
                )}
                <span className={styles.indexYears}>2025 &mdash; 2026</span>
              </fieldset>
              <div className={styles.projectGrid} id="offscript-projects">
                {projects.map((project) => (
                  <article
                    key={project.title}
                    className={styles.project}
                    data-category={project.category.toLowerCase()}
                  >
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
                        className={`${styles.projectArtwork} ${styles[project.art]}`}
                      >
                        {project.art === "afterhours" && (
                          <>
                            <span className={styles.artTopline}>
                              AFTER DARK. BEFORE TOMORROW.<span>AH/26</span>
                            </span>
                            <span
                              className={styles.afterhoursType}
                              aria-hidden="true"
                            >
                              <span>AFTER</span>
                              <span>HOURS</span>
                            </span>
                            <span
                              className={styles.afterhoursOrbit}
                              aria-hidden="true"
                            >
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                            </span>
                            <span className={styles.artBottomline}>
                              <span>
                                INDEPENDENT SOUND.
                                <br />
                                UNLIMITED FREQUENCIES.
                              </span>
                              <span>
                                19&mdash;21.06
                                <br />
                                LONDON, UK
                              </span>
                            </span>
                          </>
                        )}
                        {project.art === "form" && (
                          <>
                            <Image
                              src={project.image!}
                              alt="Looking up between angular glass towers into an open sky"
                              fill
                              sizes="(max-width: 700px) 100vw, 50vw"
                              unoptimized
                            />
                            <span className={styles.formTopline}>
                              FORM FUTURES<span>NEW PERSPECTIVES, ALWAYS.</span>
                            </span>
                            <span
                              className={styles.formType}
                              aria-hidden="true"
                            >
                              The shape
                              <br />
                              of what&apos;s
                              <br />
                              <em>next.</em>
                            </span>
                            <span
                              className={styles.formStamp}
                              aria-hidden="true"
                            >
                              <Arrow />
                            </span>
                            <span className={styles.formBottom}>
                              A PLATFORM FOR SPATIAL POSSIBILITIES.
                            </span>
                          </>
                        )}
                        {project.art === "signal" && (
                          <>
                            <Image
                              src={project.image!}
                              alt="A live music crowd with hands raised under dramatic stage lights"
                              fill
                              sizes="(max-width: 700px) 100vw, 50vw"
                              unoptimized
                            />
                            <span className={styles.signalTop}>
                              NO SIGNAL&reg;
                              <span>GO OFFLINE. FEEL EVERYTHING.</span>
                            </span>
                            <span
                              className={styles.signalType}
                              aria-hidden="true"
                            >
                              LESS
                              <br />
                              <span>SCROLL.</span>
                              <br />
                              MORE SOUL.
                            </span>
                            <span className={styles.signalBottom}>
                              THE REAL WORLD IS CALLING. <Arrow />
                            </span>
                          </>
                        )}
                        {project.art === "otherkind" && (
                          <>
                            <span className={styles.otherTop}>
                              A DIFFERENT KIND OF TOGETHER.
                              <Arrow />
                            </span>
                            <span
                              className={styles.otherFlower}
                              aria-hidden="true"
                            >
                              <i />
                              <i />
                              <i />
                              <i />
                              <span>*</span>
                            </span>
                            <span
                              className={styles.otherType}
                              aria-hidden="true"
                            >
                              otherkind<span>&reg;</span>
                            </span>
                            <span className={styles.otherBottom}>
                              HUMAN BY NATURE. OTHER BY DESIGN.
                            </span>
                          </>
                        )}
                        <span className={styles.viewProject}>
                          Explore project <Arrow />
                        </span>
                      </span>
                      <span className={styles.projectCaption}>
                        <span className={styles.projectNumber}>
                          /{project.number}
                        </span>
                        <span className={styles.projectName}>
                          {project.title}
                          <span>{project.sector}</span>
                        </span>
                        <span className={styles.projectCategory}>
                          {project.category}
                        </span>
                        <Arrow className={styles.projectArrow} />
                      </span>
                    </ProjectLink>
                  </article>
                ))}
              </div>
            </div>
            <div className={styles.workFootnote}>
              <span>GOOD PEOPLE. BOLD IDEAS. NO TWO ALIKE.</span>
              <span>
                YOUR BRAND COULD BE NEXT.{" "}
                <a href="#contact">
                  JUST SAY HELLO <Arrow />
                </a>
              </span>
            </div>
          </section>

          <section
            id="studio"
            className={styles.studio}
            aria-labelledby="studio-heading"
          >
            <div className={styles.sectionLabel}>
              <span>[ 02 / THE STUDIO ]</span>
              <span>INDEPENDENT BY DESIGN.</span>
            </div>
            <div className={styles.studioGrid}>
              <div>
                <h2 id="studio-heading">
                  NOT FOR
                  <br />
                  EVERYONE.
                  <br />
                  <span>GOOD.</span>
                </h2>
                <div className={styles.studioSignature}>
                  <span className={styles.signatureStar} aria-hidden="true">
                    &#10035;
                  </span>
                  <span>
                    A LITTLE FRICTION.
                    <br />A LOT OF FORWARD.
                  </span>
                </div>
              </div>
              <div className={styles.studioStory}>
                <p className={styles.studioLead}>
                  The world doesn&apos;t need
                  <br />
                  more of the same.
                  <br />
                  Neither does your brand.
                </p>
                <p>
                  We&apos;re OFFSCRIPT. A fiercely independent crew of
                  strategists, designers and creative troublemakers working
                  where business meets culture.
                </p>
                <p>
                  From underground sounds to emerging technology, we partner
                  with people who have something to say. Then we help them say
                  it in a way only they can.
                </p>
                <p>
                  No house style. No borrowed thinking. Just a healthy disregard
                  for the expected, and an unhealthy obsession with getting it
                  right.
                </p>
                <a href="#capabilities" className={styles.studioLink}>
                  A method to the madness <Arrow />
                </a>
              </div>
            </div>
            <dl className={styles.metrics}>
              <div>
                <dt>
                  12<span>+</span>
                </dt>
                <dd>Years going against the grain</dd>
              </div>
              <div>
                <dt>38</dt>
                <dd>Brands with a new point of view</dd>
              </div>
              <div>
                <dt>09</dt>
                <dd>Countries. One shared instinct.</dd>
              </div>
              <div>
                <dt>00</dt>
                <dd>Interest in playing it safe</dd>
              </div>
            </dl>
          </section>

          <section
            id="capabilities"
            className={styles.capabilities}
            aria-labelledby="capabilities-heading"
          >
            <div className={styles.sectionLabel}>
              <span>[ 03 / WHAT WE DO ]</span>
              <span>THINK IT. MAKE IT. MEAN IT.</span>
            </div>
            <div className={styles.capabilitiesHeading}>
              <h2 id="capabilities-heading">
                BIG THINKING.
                <br />
                DIRTY HANDS.
              </h2>
              <p>
                We connect the dots between a brave idea
                <br className={styles.desktopBreak} /> and a beautifully
                executed reality.
                <br />
                From the first question to the final pixel.
              </p>
            </div>
            <div className={styles.capabilityList}>
              {capabilities.map((capability, index) => (
                <details
                  className={styles.capability}
                  key={capability.discipline}
                  name="offscript-capabilities"
                  open={index === 0}
                >
                  <summary>
                    <span className={styles.capabilityNumber}>
                      0{index + 1}
                    </span>
                    <span className={styles.capabilityDiscipline}>
                      {capability.discipline}
                    </span>
                    <span className={styles.capabilityTitle}>
                      {capability.title}
                    </span>
                    <span className={styles.plus} aria-hidden="true" />
                  </summary>
                  <div className={styles.capabilityContent}>
                    <p>{capability.text}</p>
                    <ul>
                      {capability.services.map((service) => (
                        <li key={service}>{service}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section
            className={styles.approach}
            aria-labelledby="approach-heading"
          >
            <div className={styles.approachIntro}>
              <span className={styles.mono}>[ 04 / THE WAY WE WORK ]</span>
              <h2 id="approach-heading">
                Small team.
                <br />
                Full contact.
              </h2>
              <p>
                No layers. No handoffs into the void.
                <br />
                The people you meet are the people
                <br />
                who make your work.
              </p>
            </div>
            <ol className={styles.approachSteps}>
              <li>
                <span>01 / GET CLOSE</span>
                <h3>Listen harder.</h3>
                <p>
                  We ask the awkward questions, challenge the brief and get to
                  the real thing underneath.
                </p>
              </li>
              <li>
                <span>02 / GO SOMEWHERE</span>
                <h3>Push further.</h3>
                <p>
                  We explore, experiment and take you beyond the obvious.
                  That&apos;s where the good stuff lives.
                </p>
              </li>
              <li>
                <span>03 / MAKE IT REAL</span>
                <h3>Care more.</h3>
                <p>
                  We stay hands-on until it&apos;s out in the world. Because the
                  last 10% makes all the difference.
                </p>
              </li>
            </ol>
          </section>

          <section
            id="contact"
            className={styles.contact}
            aria-labelledby="contact-heading"
          >
            <div className={styles.sectionLabel}>
              <span>[ 05 / YOUR NEXT MOVE ]</span>
              <span>
                <i className={styles.statusDot} /> OPEN FOR GOOD TROUBLE
              </span>
            </div>
            <p className={styles.contactIntro}>
              Got an ambition that won&apos;t leave you alone?
            </p>
            <h2 id="contact-heading">
              <ContactButton
                studio="OFFSCRIPT"
                email="hello@offscript.studio"
                className={styles.giantContact}
              >
                <span>
                  LET&apos;S MAKE
                  <br />
                  SOME NOISE.
                </span>
                <Arrow />
              </ContactButton>
            </h2>
            <div className={styles.contactBottom}>
              <a href="mailto:hello@offscript.studio">
                hello@offscript.studio <Arrow />
              </a>
              <p>
                New ideas. New identities. New possibilities.
                <br />
                It all starts with a conversation.
              </p>
            </div>
          </section>
        </main>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <span>INDEPENDENT MINDS. COLLECTIVE TROUBLE.</span>
          <div>
            <a href="#work">Work</a>
            <a href="#studio">Studio</a>
            <a href="#capabilities">Capabilities</a>
            <a href="mailto:hello@offscript.studio">
              Get in touch <Arrow />
            </a>
          </div>
        </div>
        <a
          className={styles.footerWordmark}
          href="#top"
          aria-label="OFFSCRIPT, back to top"
        >
          OFFSCRIPT<span>&reg;</span>
        </a>
        <div className={styles.footerBottom}>
          <span>&copy; {new Date().getFullYear()} OFFSCRIPT STUDIO</span>
          <span>LONDON ROOTS. GLOBAL REACH.</span>
          <Link href="/">
            All concepts <Arrow />
          </Link>
          <a href="#top">
            BACK TO TOP <Arrow />
          </a>
        </div>
      </footer>
    </div>
  );
}
