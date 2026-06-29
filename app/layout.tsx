import type { Metadata } from "next";
import "./globals.css";
import "./fonts.css";

export const metadata: Metadata = { title: "Morgana", description: "Cinematic deck editor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
