import './globals.css';

export const metadata = {
  title: 'Shared To-Do',
  description: 'To-do lists you can share with read, comment and write access.',
  // opened from the iPhone Home Screen it runs like an app, which is what device notifications need there
  appleWebApp: { capable: true, title: 'Shared To-Do', statusBarStyle: 'black-translucent' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#0f1514', colorScheme: 'dark' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Caveat:wght@500..700&family=EB+Garamond:ital,wght@0,400..600;1,400..600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
