import "./globals.css";

export const metadata = {
  title: "SahaIQ Demo · Bugün kimi aramalı?",
  description: "SahaIQ canlı demo: satış verisinden RFM segmentasyonu, düşüş sinyalleri ve gerekçeli arama listesi. Kendi CSV dosyanızı tarayıcıda analiz edin.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1020" };

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
