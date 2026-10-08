import "./globals.css";

export const metadata = {
  title: "SahaIQ Demo · Bugün kimi aramalı?",
  description: "SahaIQ canlı demo: satış verisinden RFM segmentasyonu, düşüş sinyalleri ve gerekçeli arama listesi. Kendi CSV dosyanızı tarayıcıda analiz edin.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#262b31" };

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
