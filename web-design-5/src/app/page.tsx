import Link from "next/link";
import styles from "./page.module.css";

const designs = [
  {
    path: "design-one",
    name: "FORMA",
    description: "Clarity. Character. Impact.",
    color: "#f35233",
  },
  {
    path: "design-two",
    name: "STILL",
    description: "Less noise. More meaning.",
    color: "#697151",
  },
  {
    path: "design-three",
    name: "OFFSCRIPT",
    description: "Good design. Bad influence.",
    color: "#d9f548",
  },
  {
    path: "design-four",
    name: "PLAYDATE",
    description: "Serious about having fun.",
    color: "#344de4",
  },
  {
    path: "design-five",
    name: "MONOGRAM",
    description: "A distinct point of view.",
    color: "#8f7660",
  },
];

export default function Home() {
  return (
    <main className={styles.index}>
      <span className={styles.label}>CREATIVE AGENCY COLLECTION</span>
      <h1>Five independent perspectives.</h1>
      <p>Choose a design to explore.</p>
      <nav aria-label="Agency designs">
        {designs.map((design, index) => (
          <Link
            href={`/${design.path}`}
            key={design.path}
            className={styles.link}
          >
            <span className={styles.number}>0{index + 1}</span>
            <span
              className={styles.swatch}
              style={{ background: design.color }}
            />
            <span className={styles.name}>
              {design.name}
              <span>{design.description}</span>
            </span>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 19 19 5M5 5h14v14"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </Link>
        ))}
      </nav>
      <footer>Five concepts. Five different ways to see things.</footer>
    </main>
  );
}
