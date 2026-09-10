import Link from "next/link";
import styles from "./design-nav.module.css";

export default function DesignNav({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav className={styles.nav} aria-label="Design gallery">
      <Link
        href="/"
        className={styles.home}
        aria-label="Back to design gallery"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="5" height="5" rx="1" />
          <rect x="10" y="1" width="5" height="5" rx="1" />
          <rect x="1" y="10" width="5" height="5" rx="1" />
          <rect x="10" y="10" width="5" height="5" rx="1" />
        </svg>
        <span>Gallery</span>
      </Link>
      <span className={styles.divider} />
      {(["one", "two", "three"] as const).map((slug, i) => (
        <Link
          key={slug}
          href={`/design-${slug}`}
          className={styles.number}
          aria-label={`Design ${i + 1}: ${["Forma", "Offscript", "Slow Days"][i]}`}
          aria-current={current === i + 1 ? "page" : undefined}
        >
          0{i + 1}
        </Link>
      ))}
    </nav>
  );
}
