import "./globals.css";

const title = "RecoverLoop | Revenue recovery control plane";
const description =
  "Incident-aware, policy-constrained AI for recovering failed payments without retry spam.";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="application-name" content="RecoverLoop" />
        <meta name="theme-color" content="#0b0d0c" />
        <meta name="color-scheme" content="dark" />
        <meta name="robots" content="index, follow" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="RecoverLoop" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content="/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content="/og.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
