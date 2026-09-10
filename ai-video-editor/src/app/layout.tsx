import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frame | A little more story",
  description: "A thoughtful, AI-native video editor. Find your story, shape your timeline, and export real video.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
