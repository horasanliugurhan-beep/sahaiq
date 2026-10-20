import "./globals.css";
import localFont from "next/font/local";

// Ship the existing Archivo identity locally; rendering needs no font service.
const archivo = localFont({ src: "./fonts/Archivo.ttf", variable: "--font-archivo", weight: "100 900", display: "swap" });

export const metadata = {
  title: "SahaIQ Demo · Bugün kimi aramalı?",
  description: "SahaIQ canlı demo: satış verisinden RFM segmentasyonu, düşüş sinyalleri ve gerekçeli arama listesi. Kendi CSV dosyanızı tarayıcıda analiz edin.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#262b31" };

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body className={archivo.variable}>{children}</body>
    </html>
  );
}
