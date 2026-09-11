# YF Astra Hub — المنصة الموحدة

واجهة Next.js 16 موحدة لكل مشاريع YF Astra الـ ٢٦.

## التشغيل

```bash
npm install
npm run dev   # http://localhost:3000
```

## البناء للإنتاج

```bash
npm run build
npm run start
```

## المميزات

- **٢٦ مشروع** في ٥ فئات: ألعاب، فيزياء، استوديوهات، أدوات مطور، تصميم
- **بحث فوري** (⌘K أو /) + فلترة بالفئة والتقنية
- **عربي/إنجليزي** مع RTL/LTR وحفظ التفضيل
- **نسخ بلمسة** لأوامر التشغيل
- **عرض شبكي/قائمي** + بطاقات مميزة
- **محلي 100%** — لا سيرفر، لا تتبع

## إضافة مشروع

عدّل `src/lib/projects.ts`:

```ts
{
  id: "my-lab",
  dir: "my-lab",
  name: "My Lab",
  nameAr: "مختبري",
  category: "creative",
  tech: ["React", "Vite"],
  run: "npm run dev",
  // ...
}
```

ثم أضفه في `../astra.sh`.

## التقنية

- Next.js 16 App Router
- React 19
- TypeScript
- CSS inline (بدون Tailwind لتقليل الاعتماديات)
