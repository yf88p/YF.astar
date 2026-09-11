import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YF Astra — منصة المشاريع الموحدة",
  description: "٢٦ مشروع في مكان واحد — ألعاب، مختبرات فيزياء، استوديوهات إبداعية، وأدوات مطور. بسيط، احترافي، وعملي.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
