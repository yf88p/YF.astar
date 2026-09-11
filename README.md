# YF Astra — المنصة الموحدة

> **٢٦ مشروع في مكان واحد — بسيط، احترافي، وعملي.**

YF Astra هي مجموعة مشاريع متنوعة تم توحيدها في منصة واحدة سهلة الاستخدام. بدلاً من ٢٦ مستودع منفصل، الآن لديك **بوابة واحدة** تربط كل شيء.

---

## 🚀 التشغيل السريع

### المنصة الموحدة (Hub) — الواجهة الرئيسية
```bash
cd hub
npm install
npm run dev
# افتح http://localhost:3000
```
واجهة عربية/إنجليزية، بحث فوري (⌘K)، تصفية حسب الفئة والتقنية، ونسخ أوامر التشغيل بلمسة.

### سكربت موحد من الجذر
```bash
./astra.sh list              # عرض كل المشاريع
./astra.sh hub               # تشغيل المنصة الموحدة
./astra.sh dev aaa-sniping-game   # تشغيل أي مشروع
./astra.sh install           # تثبيت كل الاعتماديات
```

### تشغيل أي مشروع يدوياً
```bash
cd <project-dir>
npm install && npm run dev   # لمشاريع Vite/Next
go run .                     # لمشاريع Go (cli, automator)
open index.html              # لمشروع Minecraft المفرد
```

---

## 📦 الفئات الخمس

| الفئة | عدد | أمثلة |
|------|-----|-------|
| 🎮 **الألعاب** | 7 | Silent Ridge (قنص), FPV Drone, APEX Racing, Aeronaut, Minecraft |
| 🧪 **مختبرات الفيزياء** | 4 | Orbital, Newton Lab, Fracture Lab, Lumen Optics |
| 🎨 **الاستوديوهات الإبداعية** | 9 | Still Pottery, Circuit Lab, Forma City, Datum CAD, Margin, Excalidraw |
| 💻 **أدوات المطور والذكاء الاصطناعي** | 5 | Automator, Kanban, Kiln, OpenCode Insights, Video Editor |
| ✨ **معرض التصميم** | 2 | Three Directions, Five Perspectives |

**الإجمالي: ٢٦ مشروع + المنصة الموحدة = ٢٧ وحدة**

---

## 🗂️ هيكل المستودع

```
YF.astar/
├── hub/                    ← المنصة الموحدة (Next.js 16) ⭐ جديد
│   ├── src/app/page.tsx    ← الواجهة الرئيسية
│   └── src/lib/projects.ts ← بيانات كل المشاريع
├── astra.sh                ← سكربت التشغيل الموحد ⭐ جديد
├── README.md               ← هذا الملف ⭐ جديد
│
├── aaa-sniping-game/       ← Silent Ridge — لعبة قنص AAA
├── aim-training-arena*/    ← Deadset / Deadeye — تدريب تصويب
├── fpv-drone/              ← محاكاة FPV
├── multiplayer-racing/     ← سباقات جماعية
├── plane-game/             ← محاكي طيران
├── minecraft-single-html/  ← ماينكرافت بملف واحد
│
├── physics/                ← Orbital — كرات زجاجية
├── full-physics-engine/    ← Newton Lab — ميكانيكا 2D
├── cinematic-destruction-lab/ ← Fracture Lab
├── optical-design-lab/     ← Lumen — بصريات
│
├── asmr-pot-carving/       ← Still — فخار
├── circuit-workbench/      ← دوائر كهربائية
├── commercial-space-designer/ ← Forma Space
├── procedural-city-studio/ ← Forma City
├── constraint-cad/         ← Datum — كاد معلمي
├── infinite-zoom-storytelling/ ← Folia
├── impossible-geometry-portals/ ← Parallax
├── spatial-knowledge-workspace/ ← Margin
├── excalidraw/             ← سبورة Excalidraw
│
├── automator-go-migration/ ← مقارنة نماذج AI (Go)
├── cli/                    ← Kanban CLI (Go)
├── coding-client-from-scratch/ ← Kiln (TS)
├── opencode-token-dashboard/ ← لوحة التوكن
├── ai-video-editor/        ← محرر فيديو AI (Next)
├── web-design/             ← Three Directions
└── web-design-5/           ← Five Perspectives
```

كل مشروع **مستقل** — له `package.json` أو `go.mod` وأوامره الأصلية. المنصة لا تغيّر أي مشروع.

---

## ✨ ما الجديد في التوحيد؟

### 1. واجهة موحدة
- تصميم داكن احترافي مع لمسة ذهبية، مستوحى من Linear/Vercel
- دعم كامل للعربية (RTL) والإنجليزية (LTR) مع حفظ التفضيل
- بحث فوري، فلترة بالفئة والتقنية، عرض شبكي/قائمي
- بطاقات مميزة للبداية السريعة

### 2. تطوير عملي
- `astra.sh` — أمر واحد لعرض وتشغيل أي مشروع
- كل مشروع يحتفظ بأمره الأصلي (`npm run dev` / `go run`)
- لا سيرفر، لا API keys، لا تتبع — كل شيء محلي

### 3. بساطة
- صفر اعتماديات إضافية على المشاريع الأصلية
- المنصة مشروع Next.js مستقل في `hub/`
- انسخ أمر التشغيل بلمسة واحدة من البطاقة

---

## 🛠️ المتطلبات

- **Node.js** 20.19+ أو 22.12+ (لمشاريع Vite/Next)
- **Go** 1.22+ (لـ cli) و 1.24+ (لـ automator)
- متصفح حديث مع **WebGL 2** (للألعاب والمختبرات)
- لا حاجة لقواعد بيانات أو خدمات خارجية

---

## 🎯 للمطور — كيف تضيف مشروعاً جديداً؟

1. أضف المجلد الجديد في الجذر (مثل `my-new-lab/`)
2. افتح `hub/src/lib/projects.ts` وأضف كائن المشروع:
```ts
{
  id: "my-new-lab",
  dir: "my-new-lab",
  name: "My Lab",
  nameAr: "مختبري",
  category: "creative",
  tech: ["React", "Vite"],
  // ...
}
```
3. أضف السطر في `astra.sh` مصفوفة `projects`
4. شغّل `npm run build` في `hub/` للتحقق

---

## 📄 الترخيص

كل مشروع يحتفظ بترخيصه الأصلي. المنصة الموحدة (`hub/`, `astra.sh`) بدون ترخيص مقيد — استخدمها كما تشاء.

---

<p align="center">
  <b>YF Astra</b> — صُنع بعناية لتوحيد الإبداع.<br/>
  <sub>٢٦ مشروع · ٥ فئات · واجهة واحدة</sub>
</p>
