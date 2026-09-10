"use client";

import { useRef, useState, type FormEvent } from "react";
import DesignNav from "@/components/design-nav";
import { Arrow, InteriorScene, ObjectArt } from "./artwork";
import styles from "./page.module.css";

const pieces = [
  {
    id: "arc",
    name: "The Arc Chair",
    category: "Seating",
    material: "Solid walnut / textured linen",
    price: 680,
    kind: "chair",
    label: "A NEW PERSPECTIVE",
    description:
      "A generous curve. A gentle recline. Made from responsibly sourced solid walnut and tactile linen, the Arc is an invitation to stay a little longer.",
    dimensions: "W 78 × D 82 × H 74 cm",
  },
  {
    id: "dune",
    name: "The Dune Lamp",
    category: "Lighting",
    material: "Hand-finished ceramic / warm light",
    price: 185,
    kind: "lamp",
    label: "A WARMER GLOW",
    description:
      "Inspired by the soft contours of a shifting landscape. A hand-finished ceramic shade casts a warm, diffused light for reading, winding down, and all the in-between moments.",
    dimensions: "W 32 × D 32 × H 41 cm",
  },
  {
    id: "pebble",
    name: "The Pebble Table",
    category: "Objects",
    material: "Solid oak / natural oil finish",
    price: 295,
    kind: "table",
    label: "NATURALLY ONE OF A KIND",
    description:
      "An organic silhouette with a grounded presence. Crafted from solid European oak, each Pebble bears its own grain, knots, and quiet character. No two are quite alike.",
    dimensions: "W 54 × D 46 × H 42 cm",
  },
] as const;
type Piece = (typeof pieces)[number];
const materials = [
  { id: "clay", label: "Terracotta", hex: "#b97856" },
  { id: "oat", label: "Oat linen", hex: "#d4c5ab" },
  { id: "moss", label: "Moss", hex: "#778166" },
];

export default function Forma() {
  const [category, setCategory] = useState("All pieces");
  const [selected, setSelected] = useState<Piece>(pieces[0]);
  const [material, setMaterial] = useState("clay");
  const [saved, setSaved] = useState<string[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [journal, setJournal] = useState(0);
  const productDialog = useRef<HTMLDialogElement>(null);
  const savedDialog = useRef<HTMLDialogElement>(null);
  const journalDialog = useRef<HTMLDialogElement>(null);
  const visiblePieces = pieces.filter(
    (piece) => category === "All pieces" || piece.category === category,
  );

  function openPiece(piece: Piece) {
    setSelected(piece);
    setMaterial("clay");
    productDialog.current?.showModal();
  }
  function toggleSave(id: string) {
    setSaved((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscribed(true);
  }

  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <div className={styles.announcement}>
        Thoughtfully made. Meant to stay.
        <span>COMPLIMENTARY DELIVERY ON ORDERS OVER £150</span>
      </div>
      <header className={styles.header}>
        <a className={styles.logo} href="#top" aria-label="Forma home">
          forma<span>®</span>
        </a>
        <button
          className={styles.menuButton}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="forma-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Close −" : "Menu +"}
        </button>
        <nav
          id="forma-navigation"
          className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`}
          aria-label="Main navigation"
        >
          <a href="#collection" onClick={() => setMenuOpen(false)}>
            The collection
          </a>
          <a href="#approach" onClick={() => setMenuOpen(false)}>
            Our approach
          </a>
          <a href="#journal" onClick={() => setMenuOpen(false)}>
            Journal
          </a>
        </nav>
        <button
          className={styles.savedButton}
          type="button"
          onClick={() => savedDialog.current?.showModal()}
          aria-label={`Your saved pieces, ${saved.length}`}
        >
          <span>Saved ({saved.length})</span>
          <svg
            viewBox="0 0 20 22"
            width="16"
            height="19"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 3h12v16l-6-4-6 4z"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.tinyDot} /> OBJECTS FOR A CONSIDERED LIFE
            </p>
            <h1 id="hero-title">
              Good design.
              <br />
              Better <em>living.</em>
            </h1>
            <p className={styles.heroDescription}>
              Thoughtful furniture and everyday objects.
              <br />
              Natural materials. Lasting character.
              <br />A quieter kind of beautiful.
            </p>
            <a className={styles.primaryButton} href="#collection">
              Explore the collection <Arrow />
            </a>
            <div className={styles.heroNote}>
              <span className={styles.line} />
              <span>
                LESS, BUT BETTER.
                <br />
                SINCE 2019.
              </span>
            </div>
          </div>
          <div className={styles.heroImage}>
            <InteriorScene />
            <div className={styles.imageEdition}>
              THE ART OF FEELING AT HOME<span>COLLECTION N° 06 / 2026</span>
            </div>
            <div className={styles.roundSeal} aria-hidden="true">
              <svg viewBox="0 0 100 100">
                <defs>
                  <path
                    id="forma-seal-path"
                    d="M50 50m-36 0a36 36 0 1 1 72 0a36 36 0 1 1-72 0"
                  />
                </defs>
                <text>
                  <textPath href="#forma-seal-path" textLength="222">
                    MADE SLOWLY · MADE TO LAST ·{" "}
                  </textPath>
                </text>
              </svg>
              <span>f.</span>
            </div>
            <button
              type="button"
              className={styles.heroProduct}
              onClick={() => openPiece(pieces[0])}
            >
              <span>
                <small>IN THE PICTURE</small>
                <strong>The Arc Chair</strong>
              </span>
              <span className={styles.productCircle}>
                <Arrow diagonal />
              </span>
            </button>
          </div>
        </section>

        <div className={styles.valueStrip}>
          <span>Considered, from the very beginning.</span>
          <span>
            <i /> NATURAL MATERIALS
          </span>
          <span>
            <i /> SMALL-BATCH PRODUCTION
          </span>
          <span>
            <i /> DESIGNED TO ENDURE
          </span>
        </div>

        <section
          className={`${styles.section} ${styles.collection}`}
          id="collection"
          aria-labelledby="collection-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>01 / THE COLLECTION</p>
              <h2 id="collection-title">
                Find your <em>everyday favourite.</em>
              </h2>
            </div>
            <a className={styles.textLink} href="#pieces">
              Meet the collection <Arrow diagonal />
            </a>
          </div>
          <div className={styles.collectionToolbar}>
            <div className={styles.filters} aria-label="Filter the collection">
              {["All pieces", "Seating", "Lighting", "Objects"].map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => setCategory(item)}
                  aria-pressed={category === item}
                >
                  {item}
                </button>
              ))}
            </div>
            <span aria-live="polite">
              {String(visiblePieces.length).padStart(2, "0")} CONSIDERED PIECES
            </span>
          </div>
          <div className={styles.products} id="pieces">
            {visiblePieces.map((piece) => (
              <article className={styles.product} key={piece.id}>
                <div className={styles.productImage}>
                  <button
                    type="button"
                    className={styles.productView}
                    onClick={() => openPiece(piece)}
                    aria-label={`Discover ${piece.name}`}
                  >
                    <span className={styles.productLabel}>{piece.label}</span>
                    <ObjectArt kind={piece.kind} />
                    <span className={styles.quickView}>
                      A closer look <Arrow diagonal />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.savePiece}
                    aria-label={`${saved.includes(piece.id) ? "Unsave" : "Save"} ${piece.name}`}
                    aria-pressed={saved.includes(piece.id)}
                    onClick={() => toggleSave(piece.id)}
                  >
                    <svg
                      width="15"
                      height="19"
                      viewBox="0 0 20 22"
                      fill={saved.includes(piece.id) ? "currentColor" : "none"}
                      aria-hidden="true"
                    >
                      <path
                        d="M4 3h12v16l-6-4-6 4z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                  </button>
                </div>
                <div className={styles.productInfo}>
                  <h3>
                    <button type="button" onClick={() => openPiece(piece)}>
                      {piece.name}
                    </button>
                  </h3>
                  <span>£{piece.price}</span>
                </div>
                <p>{piece.material}</p>
                <div className={styles.productSwatches} aria-hidden="true">
                  {(piece.kind === "chair"
                    ? ["#b97856", "#d4c5ab", "#778166"]
                    : piece.kind === "lamp"
                      ? ["#dad2bf", "#a39078"]
                      : ["#aa906a", "#69513b"]
                  ).map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                  <span>
                    {piece.kind === "chair"
                      ? "3 upholstery options"
                      : "Natural finishes"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className={styles.approach}
          id="approach"
          aria-labelledby="approach-title"
        >
          <div className={styles.approachArt}>
            <InteriorScene closeup />
            <span>WARMTH IS IN THE DETAILS.</span>
          </div>
          <div className={styles.approachCopy}>
            <p className={styles.eyebrow}>02 / OUR POINT OF VIEW</p>
            <h2 id="approach-title">
              A home is not
              <br />a showroom.
              <br />
              <em>It&apos;s a feeling.</em>
            </h2>
            <p>
              We believe the things you live with should mean something. A
              well-worn armrest. The way light falls on oak. That one chair
              everyone gravitates towards.
            </p>
            <p>
              So we make fewer things, more thoughtfully. Honest materials,
              quietly distinctive forms, and the kind of quality you can feel.
              Not for a season. For your life.
            </p>
            <a className={styles.textLink} href="#principles">
              The thinking behind the things <Arrow diagonal />
            </a>
            <span className={styles.signature}>
              Made with intention. Lived with love.
            </span>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.principles}`}
          id="principles"
          aria-labelledby="principles-title"
        >
          <div className={styles.principlesIntro}>
            <p className={styles.eyebrow}>GOOD THINGS TAKE THOUGHT</p>
            <h2 id="principles-title">
              Nothing extra.
              <br />
              <em>Nothing overlooked.</em>
            </h2>
          </div>
          <div className={styles.principle}>
            <span>01</span>
            <svg viewBox="0 0 50 50" aria-hidden="true">
              <path d="M25 43V16m0 14C8 30 8 14 8 14s17 0 17 16m0-7C25 7 43 6 43 6s0 17-18 17" />
            </svg>
            <h3>Nature knows best.</h3>
            <p>
              Solid wood. Natural fibres. Earth-born finishes. Materials chosen
              for how they feel today, and how beautifully they age.
            </p>
          </div>
          <div className={styles.principle}>
            <span>02</span>
            <svg viewBox="0 0 50 50" aria-hidden="true">
              <path d="m8 24 17-10 17 10-17 10zm0 0v13l17 10 17-10V24M25 34v13M15 20V8l10-6 10 6v12M15 8l10 6 10-6M25 14v11" />
            </svg>
            <h3>Fewer. Better. Yours.</h3>
            <p>
              Small collections, made in small batches. Working with independent
              craftspeople who care about every last detail.
            </p>
          </div>
          <div className={styles.principle}>
            <span>03</span>
            <svg viewBox="0 0 50 50" aria-hidden="true">
              <path d="M25 8a17 17 0 1 1-16 11m0-10v10h10m6-4v12l8 5" />
            </svg>
            <h3>Here for the long run.</h3>
            <p>
              Beyond trends and throwaway thinking. Repairable pieces, timeless
              shapes, and a five-year structural guarantee.
            </p>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.journal}`}
          id="journal"
          aria-labelledby="journal-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>03 / NOTES FROM FORMA</p>
              <h2 id="journal-title">
                A little inspiration.
                <br />
                <em>A different perspective.</em>
              </h2>
            </div>
            <span className={styles.journalIntro}>
              Stories of spaces, people, and the
              <br />
              small things that make a home.
            </span>
          </div>
          <div className={styles.journalGrid}>
            <button
              type="button"
              className={styles.journalCard}
              onClick={() => {
                setJournal(0);
                journalDialog.current?.showModal();
              }}
            >
              <div className={styles.journalArt}>
                <InteriorScene />
              </div>
              <div className={styles.journalMeta}>
                <span>AT HOME / 5 MIN READ</span>
                <Arrow diagonal />
              </div>
              <h3>The beauty of leaving a little space.</h3>
              <p>Finding comfort in a home that has room to breathe.</p>
            </button>
            <button
              type="button"
              className={styles.journalCard}
              onClick={() => {
                setJournal(1);
                journalDialog.current?.showModal();
              }}
            >
              <div className={`${styles.journalArt} ${styles.journalObject}`}>
                <ObjectArt kind="vase" />
                <span className={styles.journalArtNote}>
                  A study in
                  <br />
                  <em>imperfection.</em>
                </span>
              </div>
              <div className={styles.journalMeta}>
                <span>MATERIAL MATTERS / 4 MIN READ</span>
                <Arrow diagonal />
              </div>
              <h3>Perfectly, naturally, imperfect.</h3>
              <p>Why the marks of making are the details worth keeping.</p>
            </button>
          </div>
        </section>

        <section
          className={styles.newsletter}
          aria-labelledby="newsletter-title"
        >
          <div>
            <p className={styles.eyebrow}>LET&apos;S STAY A LITTLE CLOSER</p>
            <h2 id="newsletter-title">
              Good things.
              <br />
              <em>Every now and then.</em>
            </h2>
          </div>
          <div className={styles.newsletterForm}>
            <p>
              New pieces, thoughtful stories, and little moments of inspiration.
              A letter from us, only when there&apos;s something worth sharing.
            </p>
            {subscribed ? (
              <div className={styles.subscribeSuccess} role="status">
                <strong>You&apos;re in good company.</strong>
                <p>
                  This is a design demo. Your email hasn&apos;t been saved or
                  subscribed to a mailing list.
                </p>
                <button type="button" onClick={() => setSubscribed(false)}>
                  Try another email <Arrow />
                </button>
              </div>
            ) : (
              <form onSubmit={subscribe}>
                <label className={styles.srOnly} htmlFor="forma-email">
                  Your email address
                </label>
                <div>
                  <input
                    type="email"
                    id="forma-email"
                    placeholder="Your email address"
                    required
                    autoComplete="email"
                  />
                  <button type="submit" aria-label="Join the Forma newsletter">
                    <Arrow />
                  </button>
                </div>
                <small>A QUIETER INBOX. WE PROMISE. · DEMO SIGN-UP</small>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <span>
            THOUGHTFUL THINGS.
            <br />
            FOR EVERYDAY LIVING.
          </span>
          <a href="#collection">The collection</a>
          <a href="#approach">Our approach</a>
          <a href="#journal">The journal</a>
          <a href="#top">
            Back to the top <Arrow />
          </a>
        </div>
        <a
          className={styles.footerWordmark}
          href="#top"
          aria-label="Forma, back to top"
        >
          forma<span>®</span>
        </a>
        <div className={styles.footerBottom}>
          <span>© FORMA 2026</span>
          <span>AN INDEPENDENT DESIGN CONCEPT</span>
          <span>LESS, BUT BETTER.</span>
        </div>
      </footer>

      <dialog
        ref={productDialog}
        className={styles.productDialog}
        aria-labelledby="product-dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget)
            productDialog.current?.close();
        }}
      >
        <button
          type="button"
          className={styles.closeDialog}
          aria-label="Close product details"
          onClick={() => productDialog.current?.close()}
        >
          ×
        </button>
        <div className={styles.dialogProductArt}>
          <ObjectArt kind={selected.kind} color={material} />
        </div>
        <div className={styles.dialogProductCopy}>
          <p className={styles.eyebrow}>
            A CLOSER LOOK / {selected.category.toUpperCase()}
          </p>
          <h2 id="product-dialog-title">{selected.name}</h2>
          <span className={styles.dialogPrice}>£{selected.price}</span>
          <p>{selected.description}</p>
          <dl>
            <div>
              <dt>Materials</dt>
              <dd>{selected.material}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{selected.dimensions}</dd>
            </div>
            <div>
              <dt>Made to order</dt>
              <dd>Estimated 4–6 weeks</dd>
            </div>
          </dl>
          {selected.kind === "chair" && (
            <fieldset className={styles.materialPicker}>
              <legend>
                Upholstery:{" "}
                {materials.find((item) => item.id === material)?.label}
              </legend>
              {materials.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-label={item.label}
                  aria-pressed={material === item.id}
                  onClick={() => setMaterial(item.id)}
                  style={{ background: item.hex }}
                />
              ))}
            </fieldset>
          )}
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => toggleSave(selected.id)}
          >
            {saved.includes(selected.id)
              ? "Saved to your collection"
              : "Save this piece"}
            <span aria-hidden="true">
              {saved.includes(selected.id) ? "✓" : "+"}
            </span>
          </button>
          <small className={styles.demoNote}>
            A design concept. Saved pieces stay in this session; no checkout or
            purchase.
          </small>
        </div>
      </dialog>

      <dialog
        ref={savedDialog}
        className={styles.savedDialog}
        aria-labelledby="saved-title"
        onClick={(event) => {
          if (event.target === event.currentTarget)
            savedDialog.current?.close();
        }}
      >
        <button
          type="button"
          className={styles.closeDialog}
          aria-label="Close saved pieces"
          onClick={() => savedDialog.current?.close()}
        >
          ×
        </button>
        <p className={styles.eyebrow}>A FEW OF YOUR FAVOURITES</p>
        <h2 id="saved-title">Your considered collection.</h2>
        {saved.length ? (
          <div className={styles.savedList}>
            {pieces
              .filter((item) => saved.includes(item.id))
              .map((item) => (
                <article key={item.id}>
                  <ObjectArt kind={item.kind} />
                  <div>
                    <h3>{item.name}</h3>
                    <span>£{item.price}</span>
                    <button
                      type="button"
                      onClick={() => toggleSave(item.id)}
                      aria-label={`Remove ${item.name} from saved pieces`}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
          </div>
        ) : (
          <p>
            There&apos;s room for something good. Explore the collection and
            save the pieces that feel like you.
          </p>
        )}
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            savedDialog.current?.close();
            document.getElementById("collection")?.scrollIntoView();
          }}
        >
          Keep exploring <Arrow />
        </button>
        <small className={styles.demoNote}>
          Your saved pieces are kept for this page session only.
        </small>
      </dialog>

      <dialog
        ref={journalDialog}
        className={styles.articleDialog}
        aria-labelledby="article-title"
        onClick={(event) => {
          if (event.target === event.currentTarget)
            journalDialog.current?.close();
        }}
      >
        <button
          type="button"
          className={styles.closeDialog}
          aria-label="Close journal story"
          onClick={() => journalDialog.current?.close()}
        >
          ×
        </button>
        <p className={styles.eyebrow}>
          NOTES FROM FORMA / {journal === 0 ? "AT HOME" : "MATERIAL MATTERS"}
        </p>
        <h2 id="article-title">
          {journal === 0
            ? "The beauty of leaving a little space."
            : "Perfectly, naturally, imperfect."}
        </h2>
        {journal === 0 ? (
          <>
            <p className={styles.articleLead}>
              A room doesn&apos;t need more things to feel more like you.
            </p>
            <p>
              There is a particular kind of peace in an uncluttered corner. A
              chair you love, a pool of afternoon light, and somewhere to put
              your cup. Nothing to rearrange. Nothing to explain.
            </p>
            <h3>Begin with how you want to feel.</h3>
            <p>
              Before choosing what belongs in a room, think about what you want
              to do there. Read without interruption. Share long meals. Sit
              beside someone without needing to say anything. Let those moments
              guide the objects you bring home.
            </p>
            <h3>Leave room for living.</h3>
            <p>
              Empty space isn&apos;t unfinished space. It gives the things
              you&apos;ve chosen room to be noticed, and gives your eye a place
              to rest. Move one thing out before bringing something new in. You
              might find the room was already complete.
            </p>
            <p>
              The most comfortable homes aren&apos;t the most perfectly
              arranged. They&apos;re the ones that leave a little room for life
              to happen.
            </p>
          </>
        ) : (
          <>
            <p className={styles.articleLead}>
              The things that make an object different are often the things that
              make it yours.
            </p>
            <p>
              A swirl in the grain. The subtle impression of a maker&apos;s
              thumb. A glaze that gathers a little darker at the base. In a
              world of identical things, these small variations remind us that
              someone, somewhere, made this.
            </p>
            <h3>Material with a memory.</h3>
            <p>
              Wood carries the record of its growth. A warm summer, a difficult
              winter, years of reaching towards light. We choose to keep that
              story visible, finishing our oak with natural oil rather than
              covering it with a heavy lacquer.
            </p>
            <h3>Beautiful now. Better with time.</h3>
            <p>
              Natural materials change with you. Leather softens, timber
              deepens, linen relaxes. Rather than chasing a finish that never
              changes, we design for the gentle marks of everyday use.
            </p>
            <p>
              Care is simple: a soft cloth, a little oil when it needs it, and
              permission to be imperfect. Some things are worth keeping exactly
              as they are.
            </p>
          </>
        )}
        <button
          className={styles.textLink}
          type="button"
          onClick={() => journalDialog.current?.close()}
        >
          Back to the journal <Arrow />
        </button>
      </dialog>
      <DesignNav current={1} />
    </div>
  );
}
