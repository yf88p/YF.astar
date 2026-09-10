"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Arrow, Asterisk, ProjectArtwork } from "./artwork";
import styles from "./page.module.css";

const projects = [
  {
    name: "Other Side",
    kind: "other-side",
    category: "Branding",
    description: "A fresh perspective on everyday energy.",
    tags: "STRATEGY / IDENTITY / PACKAGING",
    year: "2026",
    detail:
      "Taking the energy drink out of the gym and into the everyday. A bright, irreverent identity, a world of orbital graphics, and packaging that refuses to disappear on the shelf.",
    scope: "Positioning, naming, visual identity, packaging, art direction",
  },
  {
    name: "Forme",
    kind: "forme",
    category: "Digital",
    description: "Making room for a different kind of architecture.",
    tags: "IDENTITY / WEB DESIGN / DEVELOPMENT",
    year: "2026",
    detail:
      "A considered digital home for a practice that puts feeling first. Architectural proportions meet warm materials, expressive typography, and an editorial approach to showing the spaces we inhabit.",
    scope: "Brand identity, digital strategy, website design, development",
  },
  {
    name: "After Hours",
    kind: "after-hours",
    category: "Campaigns",
    description: "For the ones who never call it a night.",
    tags: "CAMPAIGN / ART DIRECTION / MOTION",
    year: "2025",
    detail:
      "An independent music festival with an unmistakable pulse. We built a kinetic visual language that moves from street posters to stage screens, turning a lineup into a whole subculture.",
    scope: "Campaign concept, art direction, poster system, motion design",
  },
  {
    name: "Good Things",
    kind: "good-things",
    category: "Branding",
    description: "Less wellness noise. More good things.",
    tags: "STRATEGY / IDENTITY / PACKAGING",
    year: "2025",
    detail:
      "A quieter, kinder take on feeling good. Tactile packaging, honest language, and a naturally playful identity turn a daily supplement into a small ritual worth looking forward to.",
    scope: "Brand strategy, tone of voice, visual identity, packaging",
  },
];

export function Projects() {
  const [filter, setFilter] = useState("All work");
  const [selected, setSelected] = useState<(typeof projects)[number] | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const visible = projects.filter(
    (project) => filter === "All work" || project.category === filter,
  );

  return (
    <>
      <div className={styles.workControls}>
        <p>A few recent departures from the ordinary.</p>
        <div
          className={styles.filters}
          role="group"
          aria-label="Filter projects by discipline"
        >
          {["All work", "Branding", "Digital", "Campaigns"].map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={filter === category}
              onClick={() => setFilter(category)}
            >
              {category}
              {category === "All work" && <sup>04</sup>}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.srOnly} role="status">
        Showing {visible.length}{" "}
        {filter === "All work" ? "" : filter.toLowerCase()} projects.
      </p>
      <div className={styles.projectGrid}>
        {visible.map((project) => (
          <button
            className={styles.projectCard}
            key={project.name}
            type="button"
            onClick={() => {
              setSelected(project);
              dialog.current?.showModal();
            }}
            aria-label={`Explore ${project.name}: ${project.description}`}
          >
            <div className={styles.projectImage}>
              <ProjectArtwork kind={project.kind} />
              <span className={styles.projectView}>
                Explore project <Arrow diagonal />
              </span>
            </div>
            <div className={styles.projectTitle}>
              <h3>{project.name}</h3>
              <span className={styles.projectArrow}>
                <Arrow diagonal />
              </span>
            </div>
            <p>{project.description}</p>
            <div className={styles.projectMeta}>
              <span>{project.tags}</span>
              <span>{project.year}</span>
            </div>
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className={`${styles.dialog} ${styles.projectDialog}`}
        aria-labelledby="offscript-project-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <button
          className={styles.closeDialog}
          type="button"
          aria-label="Close project preview"
          onClick={() => dialog.current?.close()}
        >
          <span aria-hidden="true">+</span>
        </button>
        {selected && (
          <>
            <div className={styles.dialogArt}>
              <ProjectArtwork kind={selected.kind} />
            </div>
            <div className={styles.projectDialogCopy}>
              <span className={styles.eyebrow}>
                SELECTED WORK / {selected.year}
              </span>
              <h2 id="offscript-project-title">{selected.name}</h2>
              <p>{selected.detail}</p>
              <span className={styles.eyebrow}>THE SCOPE</span>
              <p className={styles.scope}>{selected.scope}</p>
              <p className={styles.demoNote}>
                An OFFSCRIPT concept project, created for this studio demo.
              </p>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

export function ContactButton({
  variant = "nav",
}: {
  variant?: "nav" | "large";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const success = useRef<HTMLHeadingElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const id = useId();

  useEffect(() => {
    if (submitted) success.current?.focus();
  }, [submitted]);

  return (
    <>
      <button
        className={
          variant === "large" ? styles.contactLarge : styles.navContact
        }
        type="button"
        onClick={() => {
          setSubmitted(false);
          form.current?.reset();
          dialog.current?.showModal();
        }}
      >
        {variant === "large" ? (
          <>
            Let&apos;s make
            <br />
            some noise.
            <span className={styles.contactCircle}>
              <Arrow diagonal />
            </span>
          </>
        ) : (
          <>
            Let&apos;s talk <Arrow diagonal />
          </>
        )}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <button
          className={styles.closeDialog}
          type="button"
          aria-label="Close contact dialog"
          onClick={() => dialog.current?.close()}
        >
          <span aria-hidden="true">+</span>
        </button>
        <div className={styles.contactDialogCopy}>
          <Asterisk className={styles.dialogAsterisk} />
          <span className={styles.eyebrow}>
            GOOD THINGS START WITH A CONVERSATION.
          </span>
          {submitted ? (
            <>
              <h2 id={`${id}-title`} ref={success} tabIndex={-1}>
                That&apos;s a<br />
                good start.
              </h2>
              <p id={`${id}-description`} role="status">
                Demo complete. Your message has not been sent or saved. This is
                a concept form with no backend, and no one will contact you.
              </p>
              <button
                type="button"
                className={styles.solidButton}
                onClick={() => dialog.current?.close()}
              >
                Back to the good stuff <Arrow />
              </button>
            </>
          ) : (
            <>
              <h2 id={`${id}-title`}>
                What&apos;s on
                <br />
                your mind?
              </h2>
              <p id={`${id}-description`}>
                A big idea? A tricky brief? Tell us a little about it. This is a
                demo form; nothing will be sent or saved.
              </p>
              <form
                ref={form}
                className={styles.contactForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(true);
                }}
              >
                <div className={styles.formRow}>
                  <label htmlFor={`${id}-name`}>
                    Your name <span>(required)</span>
                    <input
                      id={`${id}-name`}
                      name="name"
                      autoComplete="name"
                      placeholder="Alex Taylor"
                      required
                      maxLength={100}
                    />
                  </label>
                  <label htmlFor={`${id}-email`}>
                    Your email <span>(required)</span>
                    <input
                      id={`${id}-email`}
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="alex@yourstudio.com"
                      required
                      maxLength={200}
                    />
                  </label>
                </div>
                <label htmlFor={`${id}-service`}>
                  What are you thinking?
                  <select id={`${id}-service`} name="service" defaultValue="">
                    <option value="" disabled>
                      Select a discipline
                    </option>
                    <option>Brand strategy &amp; identity</option>
                    <option>Digital experiences</option>
                    <option>Campaigns &amp; art direction</option>
                    <option>A bit of everything</option>
                  </select>
                </label>
                <label htmlFor={`${id}-brief`}>
                  The short version <span>(required)</span>
                  <textarea
                    id={`${id}-brief`}
                    name="brief"
                    placeholder="We're ready to do things differently..."
                    rows={3}
                    maxLength={2000}
                    required
                  />
                </label>
                <button className={styles.solidButton} type="submit">
                  Try the demo form <Arrow diagonal />
                </button>
                <p className={styles.demoNote}>
                  DEMO ONLY. NO BACKEND. NO DATA TRANSMITTED.
                </p>
              </form>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
