import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Three Directions | A Design Gallery",
  description:
    "Three independent design explorations. Considered objects, unconventional creativity, and a slower way to stay.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
