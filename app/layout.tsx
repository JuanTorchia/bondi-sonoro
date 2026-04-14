import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bondi Sonoro — Los colectivos de Buenos Aires, en tiempo real y en música",
  description:
    "Sonificación en vivo de los colectivos de CABA. Cada línea es una cuerda. Cuando un bondi avanza, la cuerda vibra y suena. Datos en tiempo real de la API de Transporte del GCBA.",
  openGraph: {
    title: "Bondi Sonoro",
    description:
      "Cada colectivo de Buenos Aires puntea una cuerda. Música en tiempo real.",
    type: "website",
    url: "https://bondi-sonoro.vercel.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bondi Sonoro",
    description: "Cada colectivo puntea una cuerda. En tiempo real.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
