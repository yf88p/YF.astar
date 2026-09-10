"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  Arrow,
  CoastalScene,
  RoomScene,
  Sun,
  TableScene,
} from "./illustrations";
import styles from "./slow-days.module.css";

const rooms = [
  {
    id: "garden",
    name: "The Garden Room",
    note: "A little green, a lot of peace.",
    description:
      "Olive-shaded mornings, cool linen, and French doors that open onto your own quiet corner of the garden.",
    size: "24 m²",
    guests: 2,
    price: 165,
    tag: "FOR THE DAYDREAMERS",
  },
  {
    id: "sea",
    name: "The Sea View",
    note: "Wake up on the bright side.",
    description:
      "Blue as far as the eye can see. A breezy room with a private balcony, made for coffee that turns into lunch.",
    size: "32 m²",
    guests: 2,
    price: 215,
    tag: "FOR THE SEA LOVERS",
  },
  {
    id: "casa",
    name: "The Little Casita",
    note: "Your own slice of somewhere.",
    description:
      "Two bedrooms, a lemon-tree terrace, and a little plunge pool. Bring your favourite people. Leave the schedule.",
    size: "68 m²",
    guests: 4,
    price: 325,
    tag: "FOR THE GOOD COMPANY",
  },
] as const;

type RoomId = (typeof rooms)[number]["id"];
type Filter = "all" | "two" | "four";

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function SlowDays() {
  const [filter, setFilter] = useState<Filter>("all");
  const [roomId, setRoomId] = useState<RoomId>("garden");
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [guests, setGuests] = useState("2");
  const [today, setToday] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  const room = rooms.find((item) => item.id === roomId)!;
  const nights =
    arrival && departure
      ? Math.max(
          0,
          Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000),
        )
      : 0;
  const visibleRooms = rooms.filter(
    (item) =>
      filter === "all" ||
      (filter === "two" ? item.guests === 2 : item.guests === 4),
  );

  function openBooking(selectedRoom?: RoomId) {
    if (selectedRoom) {
      setRoomId(selectedRoom);
      const capacity = rooms.find((item) => item.id === selectedRoom)!.guests;
      setGuests((value) => String(Math.min(Number(value), capacity)));
    }
    const now = new Date();
    setToday(
      new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10),
    );
    setConfirmed(false);
    setError("");
    setMenuOpen(false);
    dialogRef.current?.showModal();
  }

  function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (arrival < today || nights < 1 || Number(guests) > room.guests) {
      setError(
        "Choose an arrival from today onward, a later departure, and a guest count that fits your room.",
      );
      return;
    }
    setError("");
    setConfirmed(true);
    requestAnimationFrame(() => confirmationRef.current?.focus());
  }

  return (
    <div className={styles.site} id="top">
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <div className={styles.topline}>
        <span>A SMALL HIDEAWAY ON THE MEDITERRANEAN</span>
        <span>LESS SCROLLING. MORE STROLLING.</span>
      </div>
      <header className={styles.header}>
        <a href="#top" className={styles.logo} aria-label="Slow Days home">
          slow days
          <span className={styles.logoSun}>
            <Sun />
          </span>
          <span className={styles.logoDot}>.</span>
        </a>
        <button
          className={styles.menuButton}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="slow-days-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Close" : "Menu"}
          <span aria-hidden="true">{menuOpen ? "−" : "+"}</span>
        </button>
        <nav
          id="slow-days-navigation"
          aria-label="Main navigation"
          className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`}
        >
          <a href="#stay" onClick={() => setMenuOpen(false)}>
            The Stay
          </a>
          <a href="#slow-life" onClick={() => setMenuOpen(false)}>
            The Slow Life
          </a>
          <a href="#our-story" onClick={() => setMenuOpen(false)}>
            A Little About Us
          </a>
        </nav>
        <button
          type="button"
          className={styles.headerBook}
          onClick={() => openBooking()}
        >
          Find Your Slow <Arrow diagonal />
        </button>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.smallStar} aria-hidden="true">
                ✳
              </span>{" "}
              NOWHERE TO BE. NOTHING TO PROVE.
            </p>
            <h1 id="hero-heading">
              A little less
              <br />
              rush. A little
              <br />
              more <em>riviera.</em>
            </h1>
            <p className={styles.heroDescription}>
              Salt in your hair. Sun on your shoulders.
              <br />A small Mediterranean hideaway for
              <br className={styles.desktopBreak} /> the wonderfully unhurried.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => openBooking()}
            >
              Come Stay Awhile <Arrow />
            </button>
            <div className={styles.heroFootnote}>
              <span className={styles.handwritten}>
                Life looks better from here.
              </span>
              <svg viewBox="0 0 74 39" fill="none" aria-hidden="true">
                <path
                  d="M4 27c26 14 48 6 60-21m-13 4L65 4l1 15"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          <div className={styles.heroArt}>
            <span className={styles.artEyebrow}>
              POSTCARDS FROM A SLOWER LIFE
            </span>
            <CoastalScene />
            <div
              className={styles.holidayStamp}
              aria-label="Proud member of the no hurry club"
            >
              <span>PROUD MEMBER OF</span>
              <Sun />
              <strong>
                the no hurry
                <br />
                club
              </strong>
              <span>EST. IN A GOOD MOOD</span>
            </div>
          </div>
        </section>

        <div className={styles.ribbon} aria-label="Our favourite things">
          <span>SEA AIR</span>
          <Sun />
          <span>BARE FEET</span>
          <Sun />
          <span>LONG LUNCHES</span>
          <Sun />
          <span>LATE CHECKOUTS</span>
          <Sun />
          <span>THE GOOD KIND OF NOTHING</span>
        </div>

        <section
          className={styles.intro}
          id="our-story"
          aria-labelledby="intro-heading"
        >
          <span className={styles.sectionIndex}>01 / A DIFFERENT PACE</span>
          <h2 id="intro-heading">
            Not a place to do it all.
            <br />A place to <em>let it all go.</em>
          </h2>
          <div className={styles.introBottom}>
            <span className={styles.introDoodle} aria-hidden="true">
              <Sun />
              <span>dolce far niente</span>
            </span>
            <p>
              Tucked between an old olive grove and a very blue sea, Slow Days
              is our love letter to a simpler kind of holiday. Just twelve
              thoughtful rooms, food worth lingering over, and all the time in
              the world.
            </p>
            <a className={styles.textLink} href="#slow-life">
              A glimpse of life here <Arrow diagonal />
            </a>
          </div>
        </section>

        <section
          className={styles.stays}
          id="stay"
          aria-labelledby="stay-heading"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>02 / MAKE YOURSELF AT HOME</p>
              <h2 id="stay-heading">
                Your own little <em>somewhere.</em>
              </h2>
            </div>
            <p>
              Doors open. Shoes off.
              <br />
              Every room, a reason to stay.
            </p>
          </div>
          <div className={styles.roomToolbar}>
            <div className={styles.filters} aria-label="Filter accommodation">
              {(
                [
                  { id: "all", label: "All hideaways" },
                  { id: "two", label: "Just the two of you" },
                  { id: "four", label: "Room for a few" },
                ] as const
              ).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className={styles.roomsNote} aria-live="polite">
              {visibleRooms.length} {visibleRooms.length === 1 ? "way" : "ways"}{" "}
              to slow down
            </span>
          </div>
          <div className={styles.roomGrid}>
            {visibleRooms.map((item) => (
              <article key={item.id} className={styles.roomCard}>
                <button
                  className={styles.roomImage}
                  type="button"
                  aria-label={`Plan a stay in ${item.name}`}
                  onClick={() => openBooking(item.id)}
                >
                  <RoomScene kind={item.id} />
                  <span className={styles.roomTag}>{item.tag}</span>
                  <span className={styles.roomImageArrow}>
                    <Arrow diagonal />
                  </span>
                </button>
                <div className={styles.roomMeta}>
                  <span>
                    {item.size} <span aria-hidden="true">/</span> SLEEPS{" "}
                    {item.guests}
                  </span>
                  <span>
                    FROM <strong>&euro;{item.price}</strong> / NIGHT
                  </span>
                </div>
                <h3>{item.name}</h3>
                <p className={styles.roomNote}>{item.note}</p>
                <p className={styles.roomDescription}>{item.description}</p>
                <button
                  type="button"
                  className={styles.textLink}
                  onClick={() => openBooking(item.id)}
                >
                  This one feels like me <Arrow />
                </button>
              </article>
            ))}
          </div>
          <p className={styles.stayFootnote}>
            Always included: a very good breakfast, beach towels, and absolutely
            no alarm calls.
          </p>
        </section>

        <section
          className={styles.slowLife}
          id="slow-life"
          aria-labelledby="life-heading"
        >
          <svg
            className={styles.waveEdge}
            viewBox="0 0 1440 32"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0 32V16Q30-4 60 16t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0V32Z"
              fill="currentColor"
            />
          </svg>
          <div className={styles.lifeInner}>
            <div className={styles.lifeArt}>
              <TableScene />
              <span className={styles.lifeArtLabel}>
                FIG. 01 &nbsp; THE LUNCH THAT BECAME DINNER
              </span>
            </div>
            <div className={styles.lifeCopy}>
              <p className={styles.eyebrow}>
                03 / THE ART OF DOING VERY LITTLE
              </p>
              <h2 id="life-heading">
                A full day.
                <br />
                <em>An empty agenda.</em>
              </h2>
              <p className={styles.lifeDescription}>
                Follow the sun, not a schedule. Around here, the best things
                tend to happen when you stop making plans.
              </p>
              <div className={styles.itinerary}>
                <details open>
                  <summary>
                    <span className={styles.time}>09:00-ISH</span>
                    <span>Wake up. Wander down.</span>
                    <span className={styles.expandIcon} aria-hidden="true" />
                  </summary>
                  <p>
                    Still-warm bread, local honey, and coffee in your favourite
                    sunspot. Breakfast waits for you until 11, because a lie-in
                    is a lovely thing.
                  </p>
                </details>
                <details>
                  <summary>
                    <span className={styles.time}>SOMETIME LATER</span>
                    <span>Take the scenic route.</span>
                    <span className={styles.expandIcon} aria-hidden="true" />
                  </summary>
                  <p>
                    Borrow a bicycle, follow the coastal path to a secret
                    swimming cove, or let our little wooden boat take you
                    nowhere in particular.
                  </p>
                </details>
                <details>
                  <summary>
                    <span className={styles.time}>WHEN THE SKY TURNS PINK</span>
                    <span>One more for the road.</span>
                    <span className={styles.expandIcon} aria-hidden="true" />
                  </summary>
                  <p>
                    A spritz on the terrace. Something fresh from the garden. A
                    shared table, a second helping, and stories that go well
                    past sunset.
                  </p>
                </details>
              </div>
              <span className={styles.lifeSignoff}>
                No reservations needed. Just you.
              </span>
            </div>
          </div>
        </section>

        <section className={styles.guestStory} aria-labelledby="guest-heading">
          <div className={styles.storyLeft}>
            <p className={styles.eyebrow}>04 / SENT WITH LOVE</p>
            <h2 id="guest-heading">
              Wish you
              <br />
              were <em>here.</em>
            </h2>
            <p>
              The loveliest souvenirs
              <br />
              are the way you feel.
            </p>
          </div>
          <figure className={styles.postcard}>
            <div className={styles.postcardTop}>
              <span>A NOTE FROM THE NO HURRY CLUB</span>
              <div className={styles.postageStamp}>
                <Sun />
                <span>SLOW POST</span>
              </div>
            </div>
            <blockquote>
              &ldquo;We came for the sea.
              <br />
              We stayed for the feeling
              <br />
              of having nowhere else
              <br />
              we needed to be.&rdquo;
            </blockquote>
            <figcaption>
              <span className={styles.handwritten}>Clara &amp; James</span>
              <span>FIVE SLOW DAYS, ONE VERY HAPPY MEMORY</span>
            </figcaption>
            <span className={styles.postmark} aria-hidden="true">
              SLOW DAYS
              <br />
              <span>WITH LOVE</span>
              <br />
              MEDITERRANEAN
            </span>
          </figure>
        </section>

        <section
          className={styles.bookingSection}
          id="come-stay"
          aria-labelledby="booking-heading"
        >
          <div className={styles.bookingSun}>
            <Sun />
          </div>
          <p className={styles.eyebrow}>THERE IS NO TIME LIKE SLOW TIME</p>
          <h2 id="booking-heading">
            Your out-of-office
            <br />
            is <em>calling.</em>
          </h2>
          <p>
            A few days. A deep breath. A little more you.
            <br />
            We&apos;ll put the coffee on.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => openBooking()}
          >
            Let&apos;s Make Slow Plans <Arrow diagonal />
          </button>
          <span className={styles.bookingNote}>
            Come as you are. Stay as long as you like.
          </span>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <a
            href="#top"
            className={styles.footerLogo}
            aria-label="Slow Days, back to top"
          >
            slow days<span>.</span>
          </a>
          <p>
            A small place.
            <br />A slower pace.
            <br />
            <em>A rather lovely escape.</em>
          </p>
          <nav aria-label="Footer navigation">
            <a href="#stay">Find your room</a>
            <a href="#slow-life">Get into the slow life</a>
            <button type="button" onClick={() => openBooking()}>
              Ask about a stay <Arrow diagonal />
            </button>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>&copy; 2026 SLOW DAYS. MADE OF THE GOOD STUFF.</span>
          <span>A FICTIONAL RETREAT. A REAL GOOD FEELING.</span>
          <a href="#top">
            BACK TO THE SUNNY SIDE <span aria-hidden="true">↑</span>
          </a>
        </div>
      </footer>

      <dialog
        ref={dialogRef}
        className={styles.bookingDialog}
        aria-labelledby={confirmed ? "confirmation-heading" : "inquiry-heading"}
        aria-describedby={
          confirmed ? "confirmation-description" : "inquiry-description"
        }
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              dialogRef.current?.close();
          }
        }}
      >
        <button
          className={styles.closeDialog}
          type="button"
          aria-label="Close booking inquiry"
          onClick={() => dialogRef.current?.close()}
        >
          <span aria-hidden="true">×</span>
        </button>
        {confirmed ? (
          <div className={styles.confirmation}>
            <Sun />
            <p className={styles.eyebrow}>
              A LITTLE SOMETHING TO DAYDREAM ABOUT
            </p>
            <h2 id="confirmation-heading" ref={confirmationRef} tabIndex={-1}>
              Looks like
              <br />
              <em>your kind of slow.</em>
            </h2>
            <p id="confirmation-description">
              {name.trim().split(" ")[0]}, your demo inquiry is ready.
              Here&apos;s the little escape you imagined:
            </p>
            <div className={styles.confirmationSummary}>
              <strong>{room.name}</strong>
              <span>
                {formatDate(arrival)} to {formatDate(departure)}
              </span>
              <span>
                {nights} {nights === 1 ? "night" : "nights"} / {guests}{" "}
                {guests === "1" ? "guest" : "guests"}
              </span>
              <span>
                Estimated stay: &euro;
                {(nights * room.price).toLocaleString("en-GB")}
              </span>
            </div>
            <p className={styles.demoNotice}>
              <strong>Just a daydream, for now.</strong> This is a demo. Nothing
              has been booked, no payment was taken, and no email has been sent.
              Your details stay only in this page until you leave or refresh.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => dialogRef.current?.close()}
            >
              Back to the sunny side <Arrow />
            </button>
            <button
              type="button"
              className={styles.editInquiry}
              onClick={() => {
                setConfirmed(false);
                requestAnimationFrame(() =>
                  dialogRef.current?.querySelector("select")?.focus(),
                );
              }}
            >
              Make a little change
            </button>
          </div>
        ) : (
          <>
            <p className={styles.eyebrow}>YOUR NEXT CHAPTER, A LITTLE SLOWER</p>
            <h2 id="inquiry-heading">
              Come stay
              <br />
              <em>awhile.</em>
            </h2>
            <p id="inquiry-description" className={styles.dialogIntro}>
              Tell us what your perfect escape looks like.
              <br />
              No commitment. Just a little possibility.
            </p>
            <form onSubmit={submitInquiry} className={styles.inquiryForm}>
              <label>
                Your little somewhere
                <select
                  name="room"
                  value={roomId}
                  onChange={(event) => {
                    const next = event.target.value as RoomId;
                    setRoomId(next);
                    setGuests(
                      String(
                        Math.min(
                          Number(guests),
                          rooms.find((item) => item.id === next)!.guests,
                        ),
                      ),
                    );
                  }}
                >
                  {rooms.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · from €{item.price} / night
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.formRow}>
                <label>
                  Arriving
                  <input
                    name="arrival"
                    type="date"
                    value={arrival}
                    min={today}
                    required
                    onChange={(event) => {
                      setArrival(event.target.value);
                      if (departure && event.target.value >= departure)
                        setDeparture("");
                      setError("");
                    }}
                  />
                </label>
                <label>
                  Heading home
                  <input
                    name="departure"
                    type="date"
                    value={departure}
                    min={
                      arrival
                        ? new Date(Date.parse(arrival) + 86400000)
                            .toISOString()
                            .slice(0, 10)
                        : today
                    }
                    required
                    onChange={(event) => {
                      setDeparture(event.target.value);
                      setError("");
                    }}
                  />
                </label>
              </div>
              <div className={styles.formRow}>
                <label>
                  Good company
                  <select
                    name="guests"
                    value={guests}
                    onChange={(event) => setGuests(event.target.value)}
                  >
                    {Array.from({ length: room.guests }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1} {i === 0 ? "guest" : "guests"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Your name
                  <input
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="First name"
                    value={name}
                    required
                    maxLength={80}
                    pattern=".*\S.*"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              </div>
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@somewhere.lovely"
                  value={email}
                  required
                  maxLength={254}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <div className={styles.liveSummary} aria-live="polite">
                <div>
                  <strong>
                    {nights > 0
                      ? `${nights} ${nights === 1 ? "night" : "nights"} of the good life`
                      : "A little escape, just for you"}
                  </strong>
                  <span>
                    {nights > 0
                      ? `${guests} ${guests === "1" ? "guest" : "guests"} · Breakfast included`
                      : "Choose your dates to see an estimate"}
                  </span>
                </div>
                <strong>
                  {nights > 0
                    ? `€${(nights * room.price).toLocaleString("en-GB")}`
                    : `€${room.price}`}
                  <span>{nights > 0 ? "ESTIMATED TOTAL" : "FROM / NIGHT"}</span>
                </strong>
              </div>
              {error && (
                <p className={styles.formError} role="alert">
                  {error}
                </p>
              )}
              <button className={styles.primaryButton} type="submit">
                Preview My Slow Escape <Arrow />
              </button>
              <p className={styles.formDisclaimer}>
                A demo inquiry only. No live availability, reservation, payment,
                or email. Rates are illustrative; taxes and extras are not
                included.
              </p>
            </form>
          </>
        )}
      </dialog>
    </div>
  );
}
