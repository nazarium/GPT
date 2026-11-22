const page = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Сторінку не знайдено — Archi-Create</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/buttons.css">
  <link rel="stylesheet" href="/site-palette.css">
  <style>
    main { max-width: 72rem; margin: auto; padding: clamp(3rem, 12vh, 9rem) 6%; }
    .error-code { color: var(--accent); font-size: 1.25rem; }
    h1 { font-size: clamp(2.5rem, 7vw, 6rem); line-height: 1.1; }
    .lost-cat { display: block; width: clamp(8rem, 18vw, 12rem); height: auto; margin: 1rem 0 1.5rem; color: var(--ink); }
  </style>
</head>
<body>
  <header class="header"><a class="logo" href="/" aria-label="Archi-Create — головна"><img src="/assets/logo-original.png" alt=""><span class="brand-name">ARCHI-CREATE</span></a></header>
  <main>
    <p class="error-code">404</p>
    <h1>Сторінку не знайдено</h1>
    <svg class="lost-cat" viewBox="0 0 180 126" role="img" aria-label="Сумний котик із похиленими вушками">
      <g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M41 84C37 74 38 65 42 57L30 34Q28 28 35 30L60 39Q78 30 98 37L119 23Q124 20 123 27L120 51Q136 65 131 82C127 98 111 106 89 108C65 110 47 101 41 84Z"/>
        <path d="M39 38L48 44M116 33L108 41M57 65Q64 69 71 60M93 59Q101 66 109 60"/>
        <path d="M77 76Q82 74 87 75L82 81Z" fill="currentColor"/>
        <path d="M82 81L82 84M74 89Q81 79 90 87M51 78L22 74M52 84L23 88M114 74L145 66M115 81L147 83"/>
      </g>
      <path d="M105 68Q98 78 104 80Q112 80 105 68Z" fill="var(--accent)"/>
    </svg>
    <a class="text-link" href="/">На головну</a>
  </main>
</body>
</html>`;

export function notFound(request) {
  return new Response(request.method === 'HEAD' ? null : page, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
}
