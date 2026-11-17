import type { Metadata } from "next";
import { ContourBoard } from "@/widgets/contour/contour-board";

export const metadata: Metadata = {
  title: "Contour",
  robots: { index: false, follow: false },
};

export default function ContourPage() {
  return <ContourBoard />;
}
