import type { Metadata } from "next";
import { Londrina_Solid, Atkinson_Hyperlegible, Dancing_Script } from "next/font/google";
import "./globals.css";

const display = Londrina_Solid({ subsets: ["latin"], weight: ["400", "900"], variable: "--font-display" });
const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body" });
const cursive = Dancing_Script({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-cursive" });

export const metadata: Metadata = { title: "Morgana", description: "Cinematic deck editor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${cursive.variable}`}>
      <body>{children}</body>
    </html>
  );
}
