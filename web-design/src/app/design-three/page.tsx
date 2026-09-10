import type { Metadata } from "next";
import DesignNav from "@/components/design-nav";
import SlowDays from "./slow-days";

export const metadata: Metadata = {
  title: "Slow Days | A Little More Riviera",
  description:
    "A small, sun-soaked hideaway on the Mediterranean. Discover thoughtful rooms, long lunches, and the lovely art of doing very little at Slow Days.",
};

export default function DesignThreePage() {
  return (
    <>
      <SlowDays />
      <DesignNav current={3} />
    </>
  );
}
