"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import styles from "./agency-interactions.module.css";

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Dialog({
  titleId,
  onClose,
  children,
  project = false,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  project?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  // Portals keep each concept's broad typographic rules out of the shared dialog.
  return createPortal(
    <dialog
      ref={ref}
      className={`${styles.dialog} ${project ? styles.projectDialog : ""}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className={styles.close}
        aria-label={project ? "Close case study" : "Close inquiry"}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
      {children}
    </dialog>,
    document.body,
  );
}

export function ContactButton({
  studio,
  email = `hello@${studio.toLowerCase().replace(/[^a-z]/g, "")}.studio`,
  className,
  children,
}: {
  studio: string;
  email?: string;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const id = useId();
  const [brief, setBrief] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    email: "",
    budget: "",
    project: "",
  });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [brief]);

  function prepareBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setDraft({
      name: String(data.get("name")),
      email: String(data.get("email")),
      budget: String(data.get("budget")),
      project: String(data.get("project")),
    });
    setBrief(
      `Hello ${studio},\n\nI'd love to talk about a project.\n\nName: ${data.get("name")}\nEmail: ${data.get("email")}\nBudget: ${data.get("budget")}\n\nProject brief:\n${data.get("project")}\n\nLooking forward to connecting.`,
    );
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setIsOpen(true)}
      >
        {children}
      </button>
      {isOpen && (
        <Dialog titleId={`${id}-title`} onClose={() => setIsOpen(false)}>
          <div className={styles.content}>
            <span className={styles.eyebrow}>{studio} / NEW POSSIBILITIES</span>
            <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
              {brief ? "A good beginning." : "Tell us what you have in mind."}
            </h2>
            {brief ? (
              <div className={styles.ready}>
                <p>
                  Your inquiry is ready. Open it in your email app, or copy the
                  brief and send it to <a href={`mailto:${email}`}>{email}</a>.
                </p>
                <p className={styles.notice}>
                  Nothing has been sent yet. You can review your message before
                  sending.
                </p>
                <pre
                  className={styles.brief}
                  tabIndex={0}
                  role="region"
                  aria-label="Prepared project inquiry"
                >
                  {brief}
                </pre>
                <a
                  className={styles.submit}
                  href={`mailto:${email}?subject=${encodeURIComponent(`A new project for ${studio}`)}&body=${encodeURIComponent(brief)}`}
                >
                  Open email draft <span aria-hidden="true">↗</span>
                </a>
                <div className={styles.readyActions}>
                  <button type="button" onClick={copyBrief}>
                    {copied ? "Brief copied" : "Copy brief"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBrief("");
                      setCopied(false);
                      setCopyError(false);
                    }}
                  >
                    Edit inquiry
                  </button>
                </div>
                <span className={styles.srOnly} role="status">
                  {copied ? "Your brief has been copied to the clipboard." : ""}
                </span>
                {copyError && (
                  <p className={styles.notice} role="status">
                    Clipboard access is unavailable. You can select and copy the
                    brief above, or open the email draft.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p>
                  Big ambition or an early idea, we would love to hear it. A few
                  details will help us start the right conversation.
                </p>
              </>
            )}
            <form
              onSubmit={prepareBrief}
              className={styles.form}
              hidden={!!brief}
            >
              <div className={styles.formRow}>
                <label htmlFor={`${id}-name`}>
                  Your name
                  <input
                    id={`${id}-name`}
                    name="name"
                    defaultValue={draft.name}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    maxLength={100}
                    required
                  />
                </label>
                <label htmlFor={`${id}-email`}>
                  Email address
                  <input
                    id={`${id}-email`}
                    name="email"
                    defaultValue={draft.email}
                    autoComplete="email"
                    type="email"
                    placeholder="alex@company.com"
                    maxLength={150}
                    required
                  />
                </label>
              </div>
              <label htmlFor={`${id}-budget`}>
                Estimated budget
                <select
                  id={`${id}-budget`}
                  name="budget"
                  defaultValue={draft.budget}
                  required
                >
                  <option value="" disabled>
                    Select a range
                  </option>
                  <option>$10,000 - $25,000</option>
                  <option>$25,000 - $50,000</option>
                  <option>$50,000 - $100,000</option>
                  <option>$100,000+</option>
                  <option>Let&apos;s work it out together</option>
                </select>
              </label>
              <label htmlFor={`${id}-project`}>
                A little about your project
                <textarea
                  id={`${id}-project`}
                  name="project"
                  defaultValue={draft.project}
                  placeholder="What are you building, changing, or imagining?"
                  rows={4}
                  minLength={20}
                  maxLength={2500}
                  required
                />
              </label>
              <button className={styles.submit} type="submit">
                Prepare inquiry <span aria-hidden="true">↗</span>
              </button>
              <span className={styles.privacy}>
                Your details stay in this browser until you choose to send your
                email.
              </span>
            </form>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function ProjectLink({
  title,
  category,
  description,
  services,
  outcome,
  image,
  className,
  children,
}: {
  title: string;
  category: string;
  description: string;
  services: string[];
  outcome: string;
  image?: string;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setIsOpen(true)}
        aria-label={`View ${title} case study`}
      >
        {children}
      </button>
      {isOpen && (
        <Dialog
          titleId={`${id}-title`}
          onClose={() => setIsOpen(false)}
          project
        >
          {image && (
            <div className={styles.projectImage}>
              <Image
                src={image}
                alt={`${title} project visual`}
                fill
                sizes="(max-width: 800px) 100vw, 800px"
                unoptimized
              />
            </div>
          )}
          <div className={styles.content}>
            <span className={styles.eyebrow}>{category} / SELECTED WORK</span>
            <h2 id={`${id}-title`}>{title}</h2>
            <p>{description}</p>
            <div className={styles.projectInfo}>
              <div>
                <h3>What we did</h3>
                <ul>
                  {services.map((service) => (
                    <li key={service}>{service}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>The outcome</h3>
                <p>{outcome}</p>
              </div>
            </div>
            <button
              type="button"
              className={styles.submit}
              onClick={() => setIsOpen(false)}
            >
              Back to the work <span aria-hidden="true">↗</span>
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
