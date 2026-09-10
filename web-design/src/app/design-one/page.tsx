import type { Metadata } from "next";
import Forma from "./forma";

export const metadata: Metadata = {
  title: "Forma | Objects for a Considered Life",
  description:
    "Thoughtful furniture and everyday objects. Natural materials, honest craftsmanship, and a quieter kind of beautiful.",
};

export default function DesignOnePage() {
  return <Forma />;
}
