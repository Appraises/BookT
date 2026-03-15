import './globals.css';

export const metadata = {
  title: 'BookT — Active PDF Reader',
  description: 'Learn languages by reading PDFs with instant word lookup and vocabulary tracking',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
