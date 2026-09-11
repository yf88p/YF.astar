"use client";

import { useState, useMemo, useEffect } from "react";
import { projects, categories, stats, type Category, type Project } from "@/lib/projects";

const LANG_KEY = "astra-lang";
type Lang = "ar" | "en";

export default function Page() {
  const [lang, setLang] = useState<Lang>("ar");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [tech, setTech] = useState<string>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showPalette, setShowPalette] = useState(false);
  const isAr = lang === "ar";

  useEffect(() => {
    const s = localStorage.getItem(LANG_KEY) as Lang | null;
    if (s) setLang(s);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        document.getElementById("search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleLang = () => {
    const n = lang === "ar" ? "en" : "ar";
    setLang(n);
    localStorage.setItem(LANG_KEY, n);
    document.documentElement.lang = n;
    document.documentElement.dir = n === "ar" ? "rtl" : "ltr";
  };

  const allTech = useMemo(() => [...new Set(projects.flatMap((p) => p.tech))].sort(), []);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (tech !== "all" && !p.tech.includes(tech as any)) return false;
      if (q) {
        const hay = `${p.name} ${p.nameAr} ${p.tagline} ${p.taglineAr} ${p.description} ${p.descriptionAr} ${p.tech.join(" ")}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [q, cat, tech]);

  const featured = projects.filter((p) => p.featured);

  return (
    <div style={{ minHeight: "100vh", background: "#fcfcf9" }} dir={isAr ? "rtl" : "ltr"}>
      {/* NAV */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "rgba(252,252,249,0.8)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid #e4e4e7",
        }}
      >
        <div className="container" style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#0a0a0a",
                color: "#fafaf9",
                display: "grid",
                placeItems: "center",
                fontWeight: 900,
                fontSize: 13,
                letterSpacing: "-0.5px",
              }}
            >
              YF•
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.4px", lineHeight: 1 }}>YF Astra</div>
              <div className="mono" style={{ fontSize: 10, opacity: 0.5, letterSpacing: "0.1em" }}>
                UNIFIED · 26 PROJECTS
              </div>
            </div>
            <span
              className="mono"
              style={{
                fontSize: 10,
                background: "#f59e0b",
                color: "#0a0a0a",
                padding: "3px 8px",
                borderRadius: 999,
                fontWeight: 700,
                marginInlineStart: 8,
              }}
            >
              v1.0
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowPalette(true)}
              className="mono"
              style={{
                display: "none",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                border: "1px solid #e4e4e7",
                background: "white",
                padding: "7px 12px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <span>⌘K</span>
              <span style={{ opacity: 0.5 }}>{isAr ? "بحث سريع" : "Quick search"}</span>
            </button>
            <button
              onClick={toggleLang}
              style={{
                fontSize: 12,
                fontWeight: 700,
                border: "1px solid #e4e4e7",
                background: "white",
                padding: "7px 12px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              {isAr ? "EN" : "عربي"}
            </button>
            <a
              href="https://github.com/yf88p/YF.astar"
              target="_blank"
              rel="noopener"
              style={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                border: "1px solid #e4e4e7",
                borderRadius: 10,
                background: "white",
                textDecoration: "none",
                fontSize: 14,
              }}
              aria-label="GitHub"
            >
              ↗
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="container" style={{ paddingTop: 32, paddingBottom: 24 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 24,
          }}
        >
          <div
            style={{
              background: "#0a0a0a",
              color: "#fafaf9",
              borderRadius: 20,
              padding: "32px 28px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* glow */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(600px 300px at 85% -10%, rgba(245,158,11,0.25), transparent 60%), radial-gradient(500px 300px at -10% 100%, rgba(124,58,237,0.2), transparent 60%)",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative" }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.18em", opacity: 0.6, marginBottom: 14 }}>
                {isAr ? "منصة موحدة · بسيطة · احترافية · عملية" : "UNIFIED · SIMPLE · PROFESSIONAL · PRACTICAL"}
              </div>
              <h1
                style={{
                  fontSize: "clamp(32px, 5vw, 52px)",
                  lineHeight: 0.95,
                  letterSpacing: "-2.5px",
                  fontWeight: 900,
                  marginBottom: 14,
                }}
              >
                {isAr ? (
                  <>
                    كل مشاريعك <span style={{ color: "#f59e0b" }}>في مكان واحد.</span>
                  </>
                ) : (
                  <>
                    All your projects <span style={{ color: "#f59e0b" }}>in one place.</span>
                  </>
                )}
              </h1>
              <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.7, maxWidth: 620, marginBottom: 20 }}>
                {isAr
                  ? "٢٦ مشروع متنوع — من ألعاب AAA ومحاكاة فيزياء إلى استوديوهات مدن ودوائر وكاد وأدوات ذكاء اصطناعي. واجهة واحدة، تشغيل موحد، وتطوير أسهل."
                  : "26 diverse projects — from AAA games & physics simulations to city studios, circuit labs, CAD and AI tools. One interface, unified launch, easier development."}
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
                <a
                  href="#projects"
                  style={{
                    background: "#fafaf9",
                    color: "#0a0a0a",
                    padding: "11px 18px",
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {isAr ? "استكشف المشاريع →" : "Explore projects →"}
                </a>
                <button
                  onClick={() => {
                    const el = document.getElementById("how");
                    el?.scrollIntoView({ behavior: "smooth" });
                  }}
                  style={{
                    background: "transparent",
                    color: "#fafaf9",
                    border: "1px solid rgba(250,250,249,0.2)",
                    padding: "11px 18px",
                    borderRadius: 12,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {isAr ? "كيف يعمل" : "How it works"}
                </button>
                <span
                  className="mono"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "#a1a1aa",
                    border: "1px solid rgba(255,255,255,0.12)",
                    padding: "0 12px",
                    borderRadius: 999,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                  {isAr ? "يعمل محلياً بالكامل · بدون سيرفر" : "Fully local · No servers"}
                </span>
              </div>

              {/* stats */}
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 18 }}>
                {[
                  { k: "26", l: isAr ? "مشروع" : "Projects" },
                  { k: "5", l: isAr ? "فئات" : "Categories" },
                  { k: "10+", l: isAr ? "تقنية" : "Tech stacks" },
                  { k: "100%", l: isAr ? "محلي" : "Local-first" },
                ].map((s) => (
                  <div key={s.l} style={{ minWidth: 70 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px" }}>{s.k}</div>
                    <div className="mono" style={{ fontSize: 10, opacity: 0.5, letterSpacing: "0.1em" }}>
                      {s.l}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* featured strip */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", opacity: 0.5 }}>
                {isAr ? "مميز — ابدأ من هنا" : "FEATURED — START HERE"}
              </div>
              <div className="mono" style={{ fontSize: 11, opacity: 0.4 }}>
                {featured.length} projects
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {featured.slice(0, 4).map((p) => (
                <FeaturedCard key={p.id} p={p} isAr={isAr} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FILTERS */}
      <section id="projects" className="container" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <div
          style={{
            background: "white",
            border: "1px solid #e4e4e7",
            borderRadius: 16,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 64,
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 260px", minWidth: 220 }}>
              <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}>⌕</span>
              <input
                id="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={isAr ? "ابحث — اكتب قنص، مدينة، فيزياء..." : "Search — try sniper, city, physics..."}
                style={{
                  width: "100%",
                  padding: "10px 14px 10px 36px",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  background: "#fcfcf9",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  style={{
                    position: "absolute",
                    insetInlineEnd: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "#0a0a0a",
                    color: "white",
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <select
              value={cat}
              onChange={(e) => setCat(e.target.value as any)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #e4e4e7",
                background: "white",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <option value="all">{isAr ? "كل الفئات" : "All categories"} · {stats.total}</option>
              {(Object.keys(categories) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {categories[c].icon} {isAr ? categories[c].labelAr : categories[c].label} · {stats.byCategory[c]}
                </option>
              ))}
            </select>

            <select
              value={tech}
              onChange={(e) => setTech(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #e4e4e7",
                background: "white",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <option value="all">{isAr ? "كل التقنيات" : "All tech"}</option>
              {allTech.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", border: "1px solid #e4e4e7", borderRadius: 12, overflow: "hidden", marginInlineStart: "auto" }}>
              <button
                onClick={() => setView("grid")}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: view === "grid" ? "#0a0a0a" : "white",
                  color: view === "grid" ? "white" : "#71717a",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ▦
              </button>
              <button
                onClick={() => setView("list")}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: view === "list" ? "#0a0a0a" : "white",
                  color: view === "list" ? "white" : "#71717a",
                  border: "none",
                  cursor: "pointer",
                  borderInlineStart: "1px solid #e4e4e7",
                }}
              >
                ☰
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 11, opacity: 0.4, alignSelf: "center" }}>
              {filtered.length} {isAr ? "نتيجة" : "results"}
            </span>
            {(Object.keys(categories) as Category[]).map((c) => {
              const active = cat === c;
              return (
                <button
                  key={c}
                  onClick={() => setCat(active ? "all" : c)}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active ? "#0a0a0a" : "#e4e4e7",
                    background: active ? "#0a0a0a" : "white",
                    color: active ? "white" : "#3f3f46",
                    cursor: "pointer",
                  }}
                >
                  {categories[c].icon} {isAr ? categories[c].labelAr : categories[c].label}
                </button>
              );
            })}
            {q || cat !== "all" || tech !== "all" ? (
              <button
                onClick={() => {
                  setQ("");
                  setCat("all");
                  setTech("all");
                }}
                className="mono"
                style={{ fontSize: 11, border: "none", background: "transparent", cursor: "pointer", opacity: 0.6, textDecoration: "underline" }}
              >
                {isAr ? "مسح الفلاتر" : "Clear filters"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* GRID */}
      <section className="container" style={{ paddingBottom: 28 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              border: "1px dashed #e4e4e7",
              borderRadius: 16,
              padding: 40,
              textAlign: "center",
              background: "white",
              color: "#71717a",
            }}
          >
            {isAr ? "لا نتائج — جرّب كلمات أخرى أو امسح الفلاتر" : "No results — try different keywords or clear filters"}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: view === "grid" ? "repeat(auto-fill, minmax(300px,1fr))" : "1fr",
              gap: 14,
            }}
          >
            {filtered.map((p) => (
              <ProjectCard key={p.id} p={p} isAr={isAr} view={view} />
            ))}
          </div>
        )}
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="container" style={{ paddingBottom: 28 }}>
        <div
          style={{
            background: "white",
            border: "1px solid #e4e4e7",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "22px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.6px" }}>{isAr ? "كيف يعمل — بسيط وعملي" : "How it works — simple & practical"}</h2>
            <span className="mono" style={{ fontSize: 11, background: "#f4f4f5", padding: "6px 10px", borderRadius: 999, border: "1px solid #e4e4e7" }}>
              {isAr ? "تطوير محلي بالكامل" : "Fully local development"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 0, marginTop: 16 }}>
            <HowCard
              n="01"
              title={isAr ? "واجهة موحدة" : "Unified hub"}
              desc={
                isAr
                  ? "هذه الصفحة هي البوابة — تتصفح كل المشاريع، تبحث، وتصفي حسب الفئة أو التقنية. لا حاجة لحفظ ٢٦ رابط."
                  : "This page is the gateway — browse, search, filter by category or tech. No need to remember 26 links."
              }
            />
            <HowCard
              n="02"
              title={isAr ? "تشغيل بلمسة واحدة" : "One-command launch"}
              desc={
                isAr
                  ? "كل مشروع يحافظ على أمر التشغيل الأصلي — انسخ الأمر أو افتح المجلد. سكربت astra يوحّد التشغيل."
                  : "Each project keeps its original run command — copy it or open folder. The astra script unifies launching."
              }
            />
            <HowCard
              n="03"
              title={isAr ? "تطوير بدون احتكاك" : "Frictionless dev"}
              desc={
                isAr
                  ? "Go و Node منفصلان لكن متجاوران. ثبّت مرة واحدة لكل مشروع، واعمل بدون سيرفر أو مفاتيح API."
                  : "Go and Node coexist side-by-side. Install once per project, work with no servers or API keys."
              }
            />
          </div>

          <div
            style={{
              margin: 16,
              background: "#0a0a0a",
              color: "#fafaf9",
              borderRadius: 16,
              padding: 16,
              overflow: "hidden",
            }}
          >
            <div className="mono" style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.14em", marginBottom: 10 }}>
              {isAr ? "أوامر سريعة — انسخ والصق" : "QUICK COMMANDS — COPY & PASTE"}
            </div>
            <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
              <CodeRow label={isAr ? "تشغيل المنصة الموحدة" : "Run unified hub"} code="cd hub && npm install && npm run dev" />
              <CodeRow label={isAr ? "تشغيل أي مشروع" : "Run any project"} code="cd <project-dir> && npm install && npm run dev" />
              <CodeRow label={isAr ? "أدوات Go" : "Go tools"} code="cd cli && go build && ./kanban --help" />
              <CodeRow label={isAr ? "سكربت موحد" : "Unified script"} code="./astra.sh list && ./astra.sh dev aaa-sniping-game" />
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES OVERVIEW */}
      <section className="container" style={{ paddingBottom: 28 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
          {(Object.keys(categories) as Category[]).map((c) => (
            <div
              key={c}
              onClick={() => {
                setCat(c);
                document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                background: "white",
                border: "1px solid #e4e4e7",
                borderRadius: 16,
                padding: 16,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 8 }}>{categories[c].icon}</div>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{isAr ? categories[c].labelAr : categories[c].label}</div>
              <div style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>{isAr ? categories[c].desc : categories[c].desc}</div>
              <div className="mono" style={{ fontSize: 11, marginTop: 10, opacity: 0.5 }}>
                {stats.byCategory[c]} {isAr ? "مشاريع" : "projects"} →
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid #e4e4e7", background: "white", marginTop: 8 }}>
        <div className="container" style={{ padding: "18px 0 24px", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "#71717a" }}>
            <span style={{ fontWeight: 800, color: "#0a0a0a" }}>YF Astra</span> — {isAr ? "منصة موحدة صممت بعناية. كل مشروع يعمل محلياً." : "A unified platform, carefully crafted. Every project runs locally."}
          </div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.5, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Next.js 16 · React 19 · Go 1.24</span>
            <span>·</span>
            <span>{isAr ? "بدون تتبع · بدون سيرفر" : "No tracking · No servers"}</span>
          </div>
        </div>
      </footer>

      {/* COMMAND PALETTE */}
      {showPalette && (
        <div
          onClick={() => setShowPalette(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(6px)",
            zIndex: 50,
            display: "grid",
            placeItems: "start center",
            paddingTop: "10vh",
            paddingInline: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 560,
              background: "white",
              borderRadius: 16,
              border: "1px solid #e4e4e7",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ padding: 12, borderBottom: "1px solid #e4e4e7", display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ opacity: 0.4 }}>⌕</span>
              <input
                autoFocus
                placeholder={isAr ? "ابحث عن مشروع..." : "Search projects..."}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: "none", outline: "none", fontSize: 14 }}
              />
              <button
                onClick={() => setShowPalette(false)}
                style={{ border: "1px solid #e4e4e7", background: "white", borderRadius: 8, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
              >
                ESC
              </button>
            </div>
            <div style={{ maxHeight: 360, overflow: "auto" }}>
              {filtered.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setShowPalette(false)}
                  style={{
                    width: "100%",
                    textAlign: "start",
                    padding: "12px 16px",
                    border: "none",
                    background: "white",
                    borderBottom: "1px solid #f4f4f5",
                    cursor: "pointer",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{p.icon}</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{isAr ? p.nameAr : p.name}</div>
                    <div style={{ fontSize: 11, color: "#71717a" }}>{isAr ? p.taglineAr : p.tagline}</div>
                  </span>
                  <span className="mono" style={{ fontSize: 10, opacity: 0.4 }}>
                    {p.dir}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#71717a", fontSize: 13 }}>{isAr ? "لا نتائج" : "No matches"}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeaturedCard({ p, isAr }: { p: Project; isAr: boolean }) {
  return (
    <a
      href={`#${p.id}`}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(p.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
      style={{
        background: p.color,
        borderRadius: 16,
        padding: 14,
        textDecoration: "none",
        color: "#0a0a0a",
        border: "1px solid rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 20 }}>{p.icon}</span>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: "0.12em",
            background: "rgba(0,0,0,0.08)",
            padding: "3px 8px",
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          {p.tech[0]}
        </span>
      </div>
      <div style={{ fontWeight: 900, fontSize: 13, letterSpacing: "-0.3px" }}>{isAr ? p.nameAr : p.name}</div>
      <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.5 }}>{isAr ? p.taglineAr : p.tagline}</div>
    </a>
  );
}

function ProjectCard({ p, isAr, view }: { p: Project; isAr: boolean; view: "grid" | "list" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`cd ${p.dir} && ${p.run}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (view === "list") {
    return (
      <div
        id={p.id}
        style={{
          background: "white",
          border: "1px solid #e4e4e7",
          borderRadius: 16,
          padding: 14,
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: p.color,
            display: "grid",
            placeItems: "center",
            fontSize: 22,
            flex: "none",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          {p.icon}
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 200 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 900, fontSize: 14 }}>{isAr ? p.nameAr : p.name}</span>
            <span className="mono" style={{ fontSize: 10, background: "#f4f4f5", padding: "2px 7px", borderRadius: 999, border: "1px solid #e4e4e7" }}>
              {p.dir}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 10,
                background: p.accent,
                color: "white",
                padding: "2px 7px",
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {categories[p.category].icon} {isAr ? categories[p.category].labelAr : categories[p.category].label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>{isAr ? p.descriptionAr : p.description}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {p.tech.map((t) => (
              <span key={t} className="mono" style={{ fontSize: 10, border: "1px solid #e4e4e7", padding: "2px 6px", borderRadius: 999, background: "#fcfcf9" }}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={copy}
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e4e4e7",
              background: copied ? "#22c55e" : "white",
              color: copied ? "white" : "#0a0a0a",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied ? (isAr ? "✓ تم النسخ" : "✓ Copied") : `⧉ ${p.run}`}
          </button>
          <a
            href={`/${p.dir}`}
            onClick={(e) => e.preventDefault()}
            title={p.dir}
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "8px 12px",
              borderRadius: 10,
              background: "#0a0a0a",
              color: "white",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {isAr ? "فتح المجلد" : "Open folder"}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      id={p.id}
      className="animate-in"
      style={{
        background: "white",
        border: "1px solid #e4e4e7",
        borderRadius: 16,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ height: 92, background: p.color, position: "relative", padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <span style={{ fontSize: 28 }}>{p.icon}</span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              background: "rgba(0,0,0,0.08)",
              padding: "4px 8px",
              borderRadius: 999,
            }}
          >
            {p.tech.slice(0, 2).join(" · ")}
          </span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "white",
            border: "1px solid rgba(0,0,0,0.06)",
            padding: "4px 8px",
            borderRadius: 999,
            alignSelf: "flex-start",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.accent, display: "inline-block" }} />
          {categories[p.category].icon} {isAr ? categories[p.category].labelAr : categories[p.category].label}
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: "-0.3px" }}>{isAr ? p.nameAr : p.name}</div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.5 }}>
            {isAr ? p.taglineAr : p.tagline} · {p.dir}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#52525b", lineHeight: 1.6, flex: 1 }}>{isAr ? p.descriptionAr : p.description}</div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.tech.map((t) => (
            <span
              key={t}
              className="mono"
              style={{ fontSize: 10, background: "#f4f4f5", border: "1px solid #e4e4e7", padding: "2px 7px", borderRadius: 999 }}
            >
              {t}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`cd ${p.dir} && ${p.run}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="mono"
            style={{
              flex: 1,
              fontSize: 11,
              fontWeight: 700,
              padding: "9px 10px",
              borderRadius: 10,
              border: "1px solid #e4e4e7",
              background: copied ? "#0a0a0a" : "white",
              color: copied ? "white" : "#0a0a0a",
              cursor: "pointer",
            }}
          >
            {copied ? (isAr ? "✓ تم النسخ" : "✓ Copied") : `⧉ ${p.run}`}
          </button>
          <span
            className="mono"
            style={{
              fontSize: 10,
              padding: "9px 10px",
              borderRadius: 10,
              background: "#f4f4f5",
              border: "1px solid #e4e4e7",
              color: "#71717a",
              whiteSpace: "nowrap",
            }}
          >
            {p.port ? `:${p.port}` : "Go"}
          </span>
        </div>
      </div>
    </div>
  );
}

function HowCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div style={{ padding: "16px 22px", borderTop: "1px solid #f4f4f5", borderInlineEnd: "1px solid #f4f4f5" }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b" }}>
        {n}
      </div>
      <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#71717a", lineHeight: 1.7, marginTop: 6 }}>{desc}</div>
    </div>
  );
}

function CodeRow({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: "#f59e0b", marginTop: 2, wordBreak: "break-all" }}>
          {code}
        </div>
      </div>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1300);
        }}
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.15)",
          background: copied ? "#f59e0b" : "transparent",
          color: copied ? "#0a0a0a" : "#fafaf9",
          cursor: "pointer",
          flex: "none",
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}
