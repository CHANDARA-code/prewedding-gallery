export interface OgInfo {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  siteName: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Inserts Open Graph + Twitter card tags into the SPA's index.html for a shared photo page, replacing
 * the generic <title> and description. Crawlers (Facebook, Messenger, Telegram, ...) read these
 * without running JavaScript; browsers then boot the SPA, which opens the photo viewer.
 */
export function injectOgTags(html: string, og: OgInfo): string {
  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${esc(og.siteName)}" />`,
    `<meta property="og:title" content="${esc(og.title)}" />`,
    `<meta property="og:description" content="${esc(og.description)}" />`,
    `<meta property="og:url" content="${esc(og.url)}" />`,
    `<meta property="og:image" content="${esc(og.image)}" />`,
    `<meta property="og:image:secure_url" content="${esc(og.image)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(og.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(og.title)}" />`,
    `<meta name="twitter:description" content="${esc(og.description)}" />`,
    `<meta name="twitter:image" content="${esc(og.image)}" />`,
    `<link rel="canonical" href="${esc(og.url)}" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(og.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(og.description)}" />`)
    .replace(/<meta property="og:[^>]*>\s*/g, '')
    .replace(/<meta name="twitter:[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
}
