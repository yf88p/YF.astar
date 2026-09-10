import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Bricolage_Grotesque } from "next/font/google";
import { ContactButton, ProjectLink } from "@/components/agency-interactions";
import styles from "./page.module.css";

const playful = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-playful",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PLAYDATE | Serious about having fun.",
  description:
    "An independent creative studio for brands with a little more personality. Strategy, identity, packaging and digital experiences, made with serious play.",
};

const citrusImage =
  "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=800&q=85";
const interiorImage =
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1000&q=85";
const gardenImage =
  "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=85";

const projects = {
  goodMood: {
    title: "Good Mood",
    category: "A sunnier kind of soda",
    description:
      "Good Mood came to us with a genuinely good drink and a category full of lookalikes. We built a bright, unapologetically feel-good world around the small pleasure of cracking open a cold one. Wobbly lettering, punchy color and an optimistic voice make every can a little pick-me-up.",
    services: [
      "Brand strategy",
      "Visual identity",
      "Packaging",
      "Art direction",
    ],
    outcome:
      "A complete launch identity, a three-flavor packaging family and a playful toolkit that moves naturally from shelf to social.",
    image: citrusImage,
  },
  offscript: {
    title: "Offscript",
    category: "Culture, outside the lines",
    description:
      "An independent arts festival needed an identity as curious as its community. We threw out the neat little boxes and made a flexible visual system from oversized type, unexpected crops and shapes that refuse to sit still. A platform for beautiful, slightly odd ideas.",
    services: ["Positioning", "Visual identity", "Campaign", "Wayfinding"],
    outcome:
      "One unmistakable festival world across street posters, a digital program, artist announcements and a wonderfully loud on-site experience.",
  },
  softService: {
    title: "Soft Service",
    category: "A stay with a softer side",
    description:
      "Less check-in desk, more make yourself at home. We helped an independent guesthouse turn its warm, thoughtful approach into a brand. Tactile details, lilac accents and gently expressive typography give the everyday rituals of a stay a little extra care.",
    services: ["Naming", "Brand identity", "Website", "Guest experience"],
    outcome:
      "A welcoming name and visual identity, an intuitive booking journey and considered print details, from the room key to the last little thank-you.",
    image: interiorImage,
  },
  morrow: {
    title: "Morrow",
    category: "Good things are growing",
    description:
      "Morrow is making a greener everyday feel possible, not intimidating. We gave this neighborhood plant shop an earthy but energetic identity, pairing hand-drawn botanical characters with a wordmark that has room to grow. No green thumb required.",
    services: ["Brand strategy", "Identity", "Packaging", "E-commerce"],
    outcome:
      "A rooted, recognizable brand with recyclable packaging, friendly care guides and an online shop that helps first-time plant parents find their match.",
    image: gardenImage,
  },
};

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 25 25 6M6 6h19v19" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

function Flower({
  className = "",
  smile = false,
}: {
  className?: string;
  smile?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
    >
      {Array.from({ length: 10 }, (_, index) => (
        <ellipse
          key={index}
          cx="50"
          cy="24"
          rx="13"
          ry="23"
          transform={`rotate(${index * 36} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="29" />
      {smile && (
        <g
          fill="none"
          stroke="var(--blue)"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <path d="M37 39v7m25-7v7M33 56c8 17 27 17 35-1" />
        </g>
      )}
    </svg>
  );
}

function SodaCans({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`${styles.cans} ${compact ? styles.compactCans : ""}`}
      aria-hidden="true"
    >
      <span className={`${styles.can} ${styles.lemonCan}`}>
        <span className={styles.canRim} />
        <span className={styles.canSmall}>A LITTLE SIP OF SUNSHINE</span>
        <span className={styles.canLogo}>
          good
          <br />
          mood<span className={styles.canDot}>.</span>
        </span>
        <span className={styles.canSmile}>
          <i />
          <i />
          <b />
        </span>
        <span className={styles.canFlavor}>LEMON &amp; A LITTLE LOVE</span>
        <span className={styles.canBottom}>FEEL-GOOD SODA &middot; 330 ML</span>
      </span>
      <span className={`${styles.can} ${styles.pinkCan}`}>
        <span className={styles.canRim} />
        <span className={styles.canSmall}>GOOD THINGS INSIDE</span>
        <span className={styles.canLogo}>
          good
          <br />
          mood<span className={styles.canDot}>.</span>
        </span>
        <span className={styles.canFlower}>
          <Flower />
        </span>
        <span className={styles.canFlavor}>BLOOD ORANGE BABY</span>
        <span className={styles.canBottom}>FEEL-GOOD SODA &middot; 330 ML</span>
      </span>
    </span>
  );
}

export default function DesignFourPage() {
  return (
    <div className={`${styles.page} ${playful.variable}`} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to the good stuff
      </a>

      <header className={styles.header}>
        <a href="#top" className={styles.wordmark} aria-label="PLAYDATE home">
          playdate<span className={styles.logoSpark}>*</span>
        </a>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#work">
            The good stuff <span>01</span>
          </a>
          <a href="#studio">
            The studio <span>02</span>
          </a>
          <a href="#approach">
            How we play <span>03</span>
          </a>
        </nav>
        <ContactButton
          studio="PLAYDATE"
          email="hello@playdate.studio"
          className={styles.navContact}
        >
          Let&apos;s talk <Arrow />
        </ContactButton>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroEyebrow}>
            <span /> INDEPENDENT STUDIO. COLLECTIVE IMAGINATION.
          </div>
          <div className={styles.heroHeading}>
            <h1 id="hero-title">
              Serious about
              <br />
              having fun<span className={styles.period}>.</span>
            </h1>
            <svg
              className={styles.heroSpark}
              viewBox="0 0 90 90"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m44 4 3 26M78 17 59 37M86 51l-28-2M72 79 53 59M33 84l8-24M5 61l27-11M8 23l26 15"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </svg>
            <span className={styles.seriously}>Quite seriously.</span>
          </div>
          <div className={styles.heroIntro}>
            <p>
              We turn big ideas into brands with personality.
              <br className={styles.desktopBreak} /> A little strategy. A lot of
              heart. Never a dull moment.
            </p>
            <a href="#work" className={styles.primaryButton}>
              Meet your next favorite brand <Arrow />
            </a>
          </div>

          <div className={styles.heroCollage}>
            <span className={styles.collageNote}>
              a little peek at our world
            </span>
            <svg
              className={styles.noteArrow}
              viewBox="0 0 100 80"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 7c37-6 62 14 47 29-12 12-31 2-19-9 13-12 42 9 42 41m-13-9 14 11 9-17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <a
              className={`${styles.heroCard} ${styles.heroPoster}`}
              href="#offscript"
              aria-label="Explore the Offscript festival identity"
            >
              <span className={styles.posterTop}>
                INDEPENDENT MINDS. GOOD TIMES.
              </span>
              <span className={styles.posterHeadline}>
                PLAY
                <br />
                IS THE
                <br />
                <span>POINT.</span>
              </span>
              <Flower className={styles.posterFlower} smile />
              <span className={styles.posterBottom}>
                OFFSCRIPT&reg;<span>ART. CULTURE. SOMETHING ELSE.</span>
              </span>
            </a>
            <a
              className={`${styles.heroCard} ${styles.heroSoda}`}
              href="#good-mood"
              aria-label="Explore Good Mood soda branding and packaging"
            >
              <span className={styles.sodaBackdrop}>
                GOOD
                <br />
                ENERGY.
              </span>
              <SodaCans compact />
              <span className={styles.heroSodaCaption}>
                A BRAND THAT HITS DIFFERENT.
              </span>
            </a>
            <a
              className={`${styles.heroCard} ${styles.heroPhoto}`}
              href="#good-mood"
              aria-label="See the feel-good world of Good Mood"
            >
              <Image
                src={citrusImage}
                alt="Sunlit fresh oranges sliced open to reveal their vibrant citrus centers"
                fill
                unoptimized
                sizes="(max-width: 600px) 180px, 350px"
                loading="eager"
              />
              <span className={styles.photoScript}>
                a little
                <br />
                zest for life.
              </span>
              <span className={styles.photoBrand}>good mood.</span>
            </a>
            <div className={styles.heroSeal}>
              <Flower />
              <span>
                GOOD
                <br />
                BY DESIGN.
                <br />
                <b>FUN BY NATURE.</b>
              </span>
            </div>
            <span className={styles.collageIndex}>
              A FEW RECENT PLAYDATES / 2025&ndash;26
            </span>
          </div>
        </section>

        <div
          className={styles.ribbon}
          role="group"
          aria-label="Strategy, identity, digital, packaging, and a little mischief"
        >
          <div className={styles.ribbonInner}>
            <span>Big ideas</span>
            <Flower />
            <span>Bold identities</span>
            <Flower />
            <span>Good chemistry</span>
            <Flower />
            <span>A little mischief</span>
            <Flower />
            <span aria-hidden="true">Big ideas</span>
            <Flower />
          </div>
        </div>

        <section className={styles.work} id="work" aria-labelledby="work-title">
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>
                <Flower className={styles.tinySpark} /> SELECTED WORK /
                2025&ndash;26
              </p>
              <h2 id="work-title">
                Good work.
                <br />
                <span className={styles.serif}>Great company.</span>
              </h2>
            </div>
            <p className={styles.sectionDescription}>
              For the brave ones. The bright sparks.
              <br />
              The &ldquo;what if we did it differently?&rdquo; people.
              <br />
              Here&apos;s what happens when we play together.
            </p>
          </div>

          <div className={styles.projectGrid}>
            <article className={styles.project} id="good-mood">
              <ProjectLink
                {...projects.goodMood}
                className={styles.projectLink}
              >
                <span
                  className={`${styles.projectArt} ${styles.goodMoodArt}`}
                  role="img"
                  aria-label="Good Mood soda packaging: sunny yellow and pink cans on a coral backdrop"
                >
                  <span className={styles.projectArtEyebrow}>
                    A LITTLE SIP OF SUNSHINE.
                  </span>
                  <span className={styles.goodMoodBackdrop}>
                    good
                    <br />
                    things
                    <br />
                    ahead.
                  </span>
                  <SodaCans />
                  <span className={styles.energySeal}>
                    <Flower />
                    <span>
                      100%
                      <br />
                      GOOD
                      <br />
                      ENERGY
                    </span>
                  </span>
                  <span className={styles.artBottom}>
                    SMALL SIP. BIG FEELING.<span>GOOD MOOD&reg;</span>
                  </span>
                </span>
                <span className={styles.projectInfo}>
                  <span>
                    <span className={styles.projectTitle}>Good Mood</span>
                    <span className={styles.projectCategory}>
                      Brand strategy &middot; Identity &middot; Packaging
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow />
                  </span>
                </span>
              </ProjectLink>
            </article>

            <article
              className={`${styles.project} ${styles.offsetProject}`}
              id="offscript"
            >
              <ProjectLink
                {...projects.offscript}
                className={styles.projectLink}
              >
                <span
                  className={`${styles.projectArt} ${styles.offscriptArt}`}
                  role="img"
                  aria-label="Offscript festival identity: oversized yellow typography on a tilted coral poster with lavender stickers"
                >
                  <span className={styles.offscriptGrid} />
                  <span className={styles.festivalPoster}>
                    <span className={styles.festivalKicker}>
                      A FESTIVAL FOR BEAUTIFULLY ODD IDEAS.
                    </span>
                    <span className={styles.festivalTitle}>
                      OFF
                      <br />
                      <span>SC</span>R<br />
                      IPT<span className={styles.festivalAsterisk}>*</span>
                    </span>
                    <span className={styles.festivalFooter}>
                      GO SOMEWHERE
                      <br />
                      UNEXPECTED.
                      <span>
                        14&ndash;16
                        <br />
                        JUNE
                      </span>
                    </span>
                  </span>
                  <span className={styles.festivalSticker}>
                    STAY
                    <br />
                    <i>curious.</i>
                    <Arrow />
                  </span>
                  <span className={styles.offscriptSide}>
                    ART / MUSIC / HAPPY ACCIDENTS
                  </span>
                </span>
                <span className={styles.projectInfo}>
                  <span>
                    <span className={styles.projectTitle}>Offscript</span>
                    <span className={styles.projectCategory}>
                      Identity &middot; Art direction &middot; Campaign
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow />
                  </span>
                </span>
              </ProjectLink>
            </article>

            <article className={styles.project} id="soft-service">
              <ProjectLink
                {...projects.softService}
                className={styles.projectLink}
              >
                <span
                  className={`${styles.projectArt} ${styles.softServiceArt}`}
                  role="img"
                  aria-label="Soft Service guesthouse identity: a lavender welcome card and yellow room key in a sunlit interior"
                >
                  <Image
                    src={interiorImage}
                    alt="A thoughtfully styled, sunlit guesthouse living room with warm wood and soft natural textures"
                    fill
                    unoptimized
                    sizes="(max-width: 700px) 100vw, 55vw"
                  />
                  <span className={styles.softServiceLogo}>
                    soft
                    <br />
                    service<span>&reg;</span>
                  </span>
                  <span className={styles.softServiceCard}>
                    <span>YOU CAN EXHALE NOW.</span>
                    <b>
                      Stay a<br />
                      <i>little</i>
                      <br />
                      longer.
                    </b>
                    <span>
                      YOUR HOME, AWAY.
                      <Arrow />
                    </span>
                  </span>
                  <span className={styles.roomKey}>
                    s<span>ROOM 03</span>
                  </span>
                </span>
                <span className={styles.projectInfo}>
                  <span>
                    <span className={styles.projectTitle}>Soft Service</span>
                    <span className={styles.projectCategory}>
                      Naming &middot; Identity &middot; Digital experience
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow />
                  </span>
                </span>
              </ProjectLink>
            </article>

            <article
              className={`${styles.project} ${styles.offsetProject}`}
              id="morrow"
            >
              <ProjectLink {...projects.morrow} className={styles.projectLink}>
                <span
                  className={`${styles.projectArt} ${styles.morrowArt}`}
                  role="img"
                  aria-label="Morrow plant shop identity: a pale yellow botanical shopping bag against green garden photography"
                >
                  <span className={styles.morrowPhoto}>
                    <Image
                      src={gardenImage}
                      alt="Hands tending young green plants in a sunny garden"
                      fill
                      unoptimized
                      sizes="(max-width: 700px) 45vw, 25vw"
                    />
                  </span>
                  <span className={styles.morrowHeadline}>
                    ROOTED
                    <br />
                    IN GOOD.
                  </span>
                  <span className={styles.morrowBag}>
                    <span className={styles.bagHandle} />
                    <span className={styles.morrowLogo}>
                      morrow<span>&reg;</span>
                    </span>
                    <svg viewBox="0 0 120 150" fill="none" aria-hidden="true">
                      <path
                        d="M60 136V54M60 105C7 107 8 64 18 62c24-4 44 13 42 43Zm0-27c48 2 57-42 42-45-25-5-43 17-42 45Zm0-23C24 44 34 8 43 9c20 2 24 21 17 46Z"
                        fill="currentColor"
                      />
                      <path
                        d="M36 139h49"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                    </svg>
                    <span>A LITTLE GREENER. A LITTLE BETTER.</span>
                  </span>
                  <span className={styles.morrowNote}>room to grow.</span>
                </span>
                <span className={styles.projectInfo}>
                  <span>
                    <span className={styles.projectTitle}>Morrow</span>
                    <span className={styles.projectCategory}>
                      Strategy &middot; Identity &middot; E-commerce
                    </span>
                  </span>
                  <span className={styles.projectArrow}>
                    <Arrow />
                  </span>
                </span>
              </ProjectLink>
            </article>
          </div>
          <div className={styles.workBottom}>
            <span>Different worlds. Same all-in energy.</span>
            <ContactButton
              studio="PLAYDATE"
              email="hello@playdate.studio"
              className={styles.textLink}
            >
              Your brand could be next <Arrow />
            </ContactButton>
          </div>
        </section>

        <section
          className={styles.studio}
          id="studio"
          aria-labelledby="studio-title"
        >
          <div className={styles.studioTop}>
            <p className={styles.eyebrow}>SMALL STUDIO. VERY BIG FEELINGS.</p>
            <span>LONDON ROOTS. EVERYWHERE ENERGY.</span>
          </div>
          <div className={styles.studioGrid}>
            <div className={styles.studioCopy}>
              <h2 id="studio-title">
                Big ideas.
                <br />
                Full hearts.
                <br />
                Zero big egos.
              </h2>
              <p>
                We&apos;re strategists, designers, overthinkers and enthusiastic
                doodlers. An independent bunch who believe the best work comes
                from being open, getting curious, and enjoying the process.
              </p>
              <p>
                We get close. We ask the extra question. We care about the tiny
                details. And we&apos;ll probably make you a playlist.
              </p>
              <a href="#approach" className={styles.studioLink}>
                A little more about how we work <Arrow />
              </a>
            </div>
            <div className={styles.studioCollage}>
              <div className={styles.studioPhoto}>
                <Image
                  src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=900&q=85"
                  alt="A close-knit creative team sharing ideas around a sunny studio table"
                  fill
                  unoptimized
                  sizes="(max-width: 700px) 90vw, 45vw"
                />
                <span>REAL PEOPLE. REALLY INTO WHAT WE DO.</span>
              </div>
              <div className={styles.studioNote}>
                <span>A FRIENDLY REMINDER</span>
                <p>
                  Good people.
                  <br />
                  Good work.
                  <br />
                  <i>In that order.</i>
                </p>
                <svg viewBox="0 0 120 50" fill="none" aria-hidden="true">
                  <path
                    d="M7 17c21-7 62-7 102-2M16 28c26-9 50-6 80-2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <Flower className={styles.studioFlower} smile />
              <span className={styles.studioHandwriting}>
                your new creative friends
              </span>
            </div>
          </div>
          <div className={styles.studioValues}>
            <span>
              <b>Curiosity</b> before certainty.
            </span>
            <span>
              <b>Collaboration</b> over ego.
            </span>
            <span>
              <b>A little brave.</b> Always.
            </span>
          </div>
        </section>

        <section
          className={styles.capabilities}
          id="capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className={styles.capabilitiesIntro}>
            <p className={styles.eyebrow}>WHAT WE BRING TO THE PARTY</p>
            <h2 id="capabilities-title">
              A full box
              <br />
              of <span className={styles.serif}>possibilities.</span>
            </h2>
            <p>
              From the first &ldquo;what if&rdquo; to the final little detail.
              We connect the dots between what makes you different and what
              makes people care.
            </p>
            <svg
              className={styles.toolboxDoodle}
              viewBox="0 0 190 130"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M27 38 60 21l102 17-40 27-95-27Zm0 0 2 64 91 18 2-55m40-27-4 66-38 16M63 80l24 5M75 25 64 4m33 25L103 3m18 31 20-24"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m9 62 10 3M175 77l11 3"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className={styles.capabilityList}>
            <details className={styles.capability} open>
              <summary>
                <span className={styles.capabilityNumber}>01</span>
                <h3>Find your thing.</h3>
                <span className={styles.accordionIcon} />
              </summary>
              <div className={styles.capabilityContent}>
                <p>
                  The truth at the heart of your brand. We dig deep, join the
                  dots, and find a point of view that&apos;s unmistakably yours.
                </p>
                <ul>
                  <li>Brand strategy</li>
                  <li>Positioning</li>
                  <li>Naming</li>
                  <li>Tone of voice</li>
                </ul>
              </div>
            </details>
            <details className={styles.capability}>
              <summary>
                <span className={styles.capabilityNumber}>02</span>
                <h3>Look the part.</h3>
                <span className={styles.accordionIcon} />
              </summary>
              <div className={styles.capabilityContent}>
                <p>
                  Not just a pretty logo. A distinctive, flexible visual world
                  that feels like you, from the big picture to the smallest
                  label.
                </p>
                <ul>
                  <li>Visual identity</li>
                  <li>Packaging</li>
                  <li>Art direction</li>
                  <li>Brand guidelines</li>
                </ul>
              </div>
            </details>
            <details className={styles.capability}>
              <summary>
                <span className={styles.capabilityNumber}>03</span>
                <h3>Make some noise.</h3>
                <span className={styles.accordionIcon} />
              </summary>
              <div className={styles.capabilityContent}>
                <p>
                  Ideas that make people stop, smile, and feel something. We
                  turn your brand story into a conversation worth joining.
                </p>
                <ul>
                  <li>Creative campaigns</li>
                  <li>Social content</li>
                  <li>Motion</li>
                  <li>Copywriting</li>
                </ul>
              </div>
            </details>
            <details className={styles.capability}>
              <summary>
                <span className={styles.capabilityNumber}>04</span>
                <h3>Bring it to life.</h3>
                <span className={styles.accordionIcon} />
              </summary>
              <div className={styles.capabilityContent}>
                <p>
                  Good-looking is good. Good-looking and a joy to use is better.
                  We build thoughtful digital experiences that work as hard as
                  they play.
                </p>
                <ul>
                  <li>Web design</li>
                  <li>Development</li>
                  <li>E-commerce</li>
                  <li>Digital experiences</li>
                </ul>
              </div>
            </details>
          </div>
        </section>

        <section
          className={styles.approach}
          id="approach"
          aria-labelledby="approach-title"
        >
          <div className={styles.approachHeading}>
            <p className={styles.eyebrow}>THE METHOD IN THE PLAYFULNESS</p>
            <h2 id="approach-title">
              Room to play.
              <br />
              <span className={styles.serif}>A reason for everything.</span>
            </h2>
            <p>
              Loose enough for happy accidents.
              <br />
              Thoughtful enough to make them count.
            </p>
          </div>
          <div className={styles.processGrid}>
            <article className={styles.processStep}>
              <span className={styles.processNumber}>
                01<span>?</span>
              </span>
              <p className={styles.stepLabel}>LISTEN &amp; LOOK CLOSER</p>
              <h3>Start with curiosity.</h3>
              <p>
                We get to know your world, your people, and the ambition keeping
                you up at night. No assumptions. Plenty of good questions.
              </p>
            </article>
            <article className={styles.processStep}>
              <span className={styles.processNumber}>
                02
                <svg viewBox="0 0 65 65" fill="none" aria-hidden="true">
                  <path
                    d="M14 47 40 10l13 10-27 36-16 4 4-13Zm0 0 12 9m11-41 13 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <p className={styles.stepLabel}>EXPLORE &amp; MAKE A MESS</p>
              <h3>Follow the what-ifs.</h3>
              <p>
                We sketch, test, rethink and push a little further. You&apos;re
                part of the process, not waiting on the other side of a big
                reveal.
              </p>
            </article>
            <article className={styles.processStep}>
              <span className={styles.processNumber}>
                03
                <Flower />
              </span>
              <p className={styles.stepLabel}>REFINE &amp; RELEASE</p>
              <h3>Make it mean something.</h3>
              <p>
                We turn the spark into a beautifully crafted, working brand.
                Then hand you the tools and confidence to take it out into the
                world.
              </p>
            </article>
          </div>
          <p className={styles.processFootnote}>
            Serious craft. No mysterious creative process. <span>Promise.</span>
          </p>
        </section>

        <section
          className={styles.testimonial}
          aria-labelledby="testimonial-title"
        >
          <p className={styles.eyebrow} id="testimonial-title">
            NICE WORDS FROM GOOD PEOPLE
          </p>
          <div className={styles.quoteMark} aria-hidden="true">
            &ldquo;
          </div>
          <figure>
            <blockquote>
              They took the thing we believed in
              <br className={styles.desktopBreak} /> and made it a brand you can{" "}
              <em>feel.</em>
              <br />
              Big talent. Zero ego. An absolute joy.
            </blockquote>
            <figcaption>
              <span className={styles.clientAvatar}>
                JC
                <Flower />
              </span>
              <span>
                <b>Jamie Chen</b>
                <span>Founder, Good Mood</span>
              </span>
              <span className={styles.clientLogo}>good mood.</span>
            </figcaption>
          </figure>
          <svg
            className={styles.testimonialDoodle}
            viewBox="0 0 100 90"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M48 78C28 65 5 43 12 23c6-18 27-14 37 2 11-25 37-19 39 0 2 21-20 39-40 53Z"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m7 74-4 9m84-20 10 4M78 5l5-4"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </section>

        <section
          className={styles.contact}
          id="contact"
          aria-labelledby="contact-title"
        >
          <div className={styles.contactTop}>
            <p className={styles.eyebrow}>
              <span className={styles.availableDot} /> OPEN FOR GOOD
              CONVERSATIONS
            </p>
            <span>YOUR NEXT CHAPTER STARTS WITH A HELLO.</span>
          </div>
          <div className={styles.contactMain}>
            <div>
              <h2 id="contact-title">
                Got a good
                <br />
                <span>feeling?</span>
              </h2>
              <p>
                A big ambition. A half-formed idea. A doodle on a napkin.
                <br />
                Whatever you&apos;re starting with, let&apos;s make something of
                it.
              </p>
            </div>
            <div className={styles.contactStickerWrap}>
              <span className={styles.contactHandwriting}>trust it.</span>
              <svg
                className={styles.contactArrow}
                viewBox="0 0 110 100"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 7c80-15 88 39 54 42-23 3-21-26 2-18 20 7 18 38 7 57m-8-17 6 19 20-8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <ContactButton
                studio="PLAYDATE"
                email="hello@playdate.studio"
                className={styles.contactSticker}
              >
                <Flower />
                <span>
                  LET&apos;S
                  <br />
                  MAKE
                  <br />A PLAYDATE.
                  <Arrow />
                </span>
              </ContactButton>
            </div>
          </div>
          <div className={styles.contactDetails}>
            <a href="mailto:hello@playdate.studio">
              hello@playdate.studio <Arrow />
            </a>
            <span>
              Based in London.
              <br />
              Playing nicely everywhere.
            </span>
            <a href="#top" className={styles.backTop}>
              Back to the top <Arrow />
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerLogo} aria-label="PLAYDATE">
          playdate<span>*</span>
        </div>
        <div className={styles.footerBottom}>
          <span>&copy; {new Date().getFullYear()} PLAYDATE STUDIO</span>
          <span>MADE WITH INTENTION. AND A LITTLE MISCHIEF.</span>
          <Link href="/">
            All concepts <Arrow />
          </Link>
        </div>
      </footer>
    </div>
  );
}
