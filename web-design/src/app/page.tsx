import Link from "next/link";
import styles from "./page.module.css";

const designs = [
  {
    slug: "one",
    name: "Forma",
    category: "OBJECTS & EVERYDAY LIVING",
    description: "Warm minimalism. Thoughtfully made.",
    theme: "forma",
  },
  {
    slug: "two",
    name: "Offscript",
    category: "INDEPENDENT CREATIVE STUDIO",
    description: "Bold ideas. A different point of view.",
    theme: "offscript",
  },
  {
    slug: "three",
    name: "Slow Days",
    category: "A MEDITERRANEAN HIDEAWAY",
    description: "Sea air. Soft edges. A slower pace.",
    theme: "slowdays",
  },
];

export default function Home() {
  return (
    <main className={styles.index}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>
          three directions<span>®</span>
        </Link>
        <span>A MINI DESIGN GALLERY / VOL. 01</span>
      </header>
      <section className={styles.intro}>
        <div className={styles.eyebrow}>
          <span /> ONE CANVAS. THREE POINTS OF VIEW.
        </div>
        <h1>Where shall we go?</h1>
        <p>Three distinct worlds, made to be explored. Pick a direction.</p>
      </section>
      <nav className={styles.designs} aria-label="Explore the three designs">
        {designs.map((design, i) => (
          <Link
            href={`/design-${design.slug}`}
            key={design.slug}
            className={styles.card}
          >
            <div
              className={`${styles.preview} ${styles[design.theme]}`}
              aria-hidden="true"
            >
              <span className={styles.previewIndex}>EXPLORATION 0{i + 1}</span>
              {i === 0 && (
                <>
                  <div className={styles.arch} />
                  <div className={styles.formaOrb} />
                  <div className={styles.formaTable} />
                  <span className={styles.formaTitle}>
                    forma<span>Objects for a considered life.</span>
                  </span>
                </>
              )}
              {i === 1 && (
                <>
                  <span className={styles.offscriptTitle}>
                    GO
                    <br />
                    OFF
                    <br />
                    <i>SCRIPT.</i>
                  </span>
                  <span className={styles.asterisk}>✳</span>
                  <span className={styles.offscriptLabel}>
                    LESS EXPECTED. MORE REMEMBERED.
                  </span>
                </>
              )}
              {i === 2 && (
                <>
                  <div className={styles.slowSun} />
                  <div className={styles.slowSea} />
                  <div className={styles.slowCliff} />
                  <span className={styles.slowTitle}>
                    slow
                    <br />
                    <i>days.</i>
                  </span>
                  <span className={styles.slowLabel}>
                    A LITTLE MORE RIVIERA.
                  </span>
                </>
              )}
              <span className={styles.previewArrow}>↗</span>
            </div>
            <div className={styles.cardMeta}>
              <span>
                0{i + 1} / {design.category}
              </span>
              <h2>
                {design.name}
                <span aria-hidden="true">↗</span>
              </h2>
              <p>{design.description}</p>
            </div>
          </Link>
        ))}
      </nav>
      <footer className={styles.footer}>
        <span>THREE DESIGNS. NO WRONG TURNS.</span>
        <span>INDEPENDENT EXPLORATIONS · 2026</span>
      </footer>
    </main>
  );
}
