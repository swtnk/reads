// scripts/generate-manifest.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/plugins/contentManifest.ts
import fs from "node:fs";
import path from "node:path";

// src/core/parser/frontmatter.ts
var FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
var parseFrontmatter = (md) => {
  const match = FRONTMATTER_RE.exec(md);
  if (!match?.[0] || !match[1]) {
    return { metadata: null, body: md };
  }
  const metadata = {};
  for (const line of match[1].split(`
`)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key) {
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const arrayValue = value.slice(1, -1).split(",").map((item) => item.trim()).filter((item) => item.length > 0);
      metadata[key] = arrayValue;
      continue;
    }
    metadata[key] = value;
  }
  return {
    metadata,
    body: md.slice(match[0].length)
  };
};

// src/core/content.ts
var toTitle = (value) => {
  return value.replaceAll(/[-_]+/g, " ").split(" ").filter((part) => part.length > 0).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
};
var toSummary = (markdownBody) => {
  const text = markdownBody.replaceAll(/```[\s\S]*?```/g, "").replaceAll(/`([^`]+)`/g, "$1").replaceAll(/\*\*([^*]+)\*\*/g, "$1").replaceAll(/\*([^*]+)\*/g, "$1").replaceAll(/#+\s*/g, "").replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1").replaceAll(/<[^>]*>/g, "").replaceAll(/\s+/g, " ").trim();
  if (!text) {
    return "Open this article to read the full content.";
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};
var isExcludedContentPath = (relativePath) => {
  const parts = relativePath.split("/");
  return parts.some((part) => part.startsWith("."));
};
var isUnlistedContentPath = (relativePath) => {
  const parts = relativePath.split("/");
  return parts.some((part) => part.startsWith("_"));
};

// src/plugins/contentManifest.ts
var findMarkdownFiles = (dir, base = "") => {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(path.join(dir, entry.name), relative));
    } else if (entry.name.endsWith(".md")) {
      results.push(relative);
    }
  }
  return results;
};
var metaString = (metadata, key, fallback) => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};
var metaTags = (metadata) => {
  if (Array.isArray(metadata?.tags)) {
    return metadata.tags.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof metadata?.tags === "string") {
    return metadata.tags.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
};
var metaBool = (metadata, key) => metadata?.[key] === "true" || metadata?.[key] === "yes" || metadata?.[key] === "1";
var buildArticle = (relativePath, markdown, basePath) => {
  if (isExcludedContentPath(relativePath)) {
    return;
  }
  const pathWithoutExt = relativePath.replace(/\.md$/i, "");
  const pathParts = pathWithoutExt.split("/").filter((part) => part.length > 0);
  if (pathParts.length === 0) {
    return;
  }
  const fileSlug = pathParts.at(-1) ?? "article";
  const categoryPath = pathParts.slice(0, -1);
  const cleanBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const { metadata, body } = parseFrontmatter(markdown);
  const routeSlug = metaString(metadata, "slug", "") || fileSlug;
  const routePath = categoryPath.length > 0 ? `/${categoryPath.join("/")}/${routeSlug}/` : `/${routeSlug}/`;
  return {
    id: relativePath,
    title: metaString(metadata, "title", toTitle(fileSlug)),
    menuTitle: metaString(metadata, "menuTitle", ""),
    description: metaString(metadata, "description", toSummary(body)),
    date: metaString(metadata, "date", ""),
    author: metaString(metadata, "author", "Editorial"),
    category: metaString(metadata, "category", "") || toTitle(categoryPath.at(-1) ?? "general"),
    tags: metaTags(metadata),
    cover: metaString(metadata, "cover", ""),
    featured: metaBool(metadata, "featured"),
    route: `${cleanBase}${routePath}`,
    categoryPath
  };
};
var sortArticles = (articles) => {
  return [...articles].sort((left, right) => {
    const leftTime = left.date ? Date.parse(left.date) : Number.NaN;
    const rightTime = right.date ? Date.parse(right.date) : Number.NaN;
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (!Number.isNaN(rightTime) && Number.isNaN(leftTime)) {
      return 1;
    }
    if (!Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
      return -1;
    }
    return left.title.localeCompare(right.title);
  });
};
var getOrCreateCategory = (container, slug, parentId) => {
  const categoryId = parentId ? `${parentId}/${slug}` : slug;
  const existing = container.get(slug);
  if (existing) {
    return existing;
  }
  const node = {
    id: categoryId,
    title: toTitle(slug),
    slug,
    categories: new Map,
    articles: []
  };
  container.set(slug, node);
  return node;
};
var toImmutableCategories = (container) => {
  return [...container.values()].sort((left, right) => left.title.localeCompare(right.title)).map((node) => ({
    id: node.id,
    title: node.title,
    slug: node.slug,
    categories: toImmutableCategories(node.categories),
    articles: [...node.articles].sort((a, b) => a.localeCompare(b))
  }));
};
var buildCategoryTree = (articles) => {
  const root = new Map;
  const rootArticles = [];
  for (const article of articles) {
    if (isUnlistedContentPath(article.id)) {
      continue;
    }
    if (article.categoryPath.length === 0) {
      rootArticles.push(article.id);
      continue;
    }
    let current = root;
    let parentId = "";
    for (const segment of article.categoryPath) {
      const node = getOrCreateCategory(current, segment, parentId);
      parentId = node.id;
      current = node.categories;
    }
    const leafParent = article.categoryPath.reduce((acc, segment, index) => {
      if (index === 0) {
        return root.get(segment) ?? null;
      }
      return acc?.categories.get(segment) ?? null;
    }, null);
    if (leafParent) {
      leafParent.articles.push(article.id);
    }
  }
  return {
    categories: toImmutableCategories(root),
    rootArticles: [...rootArticles].sort((a, b) => a.localeCompare(b))
  };
};
var buildManifest = (contentDir, basePath) => {
  const mdFiles = findMarkdownFiles(contentDir);
  const articles = mdFiles.flatMap((relativePath) => {
    const fullPath = path.join(contentDir, relativePath);
    const markdown = fs.readFileSync(fullPath, "utf-8");
    const article = buildArticle(relativePath, markdown, basePath);
    return article ? [article] : [];
  });
  const sortedArticles = sortArticles(articles);
  const { categories, rootArticles } = buildCategoryTree(sortedArticles);
  return {
    generatedAt: new Date().toISOString(),
    articles: sortedArticles,
    categories,
    rootArticles
  };
};
var compactArticle = (article) => {
  const compact = {
    id: article.id,
    title: article.title,
    description: article.description,
    date: article.date,
    author: article.author,
    category: article.category,
    route: article.route
  };
  if (article.menuTitle)
    compact.menuTitle = article.menuTitle;
  if (article.tags.length > 0)
    compact.tags = article.tags;
  if (article.cover)
    compact.cover = article.cover;
  if (article.featured)
    compact.featured = true;
  if (article.categoryPath.length > 0)
    compact.categoryPath = article.categoryPath;
  return compact;
};
var serializeManifest = (manifest) => {
  return JSON.stringify({
    generatedAt: manifest.generatedAt,
    articles: manifest.articles.map(compactArticle),
    categories: manifest.categories,
    rootArticles: manifest.rootArticles
  });
};

// src/config/site.ts
var SITE_CONFIG = {
  url: "https://swetanksubham.com/reads",
  defaultTheme: "light",
  header: {
    title: "Reads",
    subtitle: "My thoughts, in writing",
    homeLabel: "Home",
    composeLabel: "Compose",
    items: []
  },
  footer: {
    textTemplate: "{count} article(s) · Designed and developed by [me](https://swetanksubham.com)"
  },
  home: {
    heroTitle: "Insights, ideas, and practical engineering notes",
    heroSubtitle: "A web-first publication with featured stories, latest updates, and weekly highlights.",
    latestTitle: "Latest Articles",
    featuredCount: 1,
    latestCount: 6
  }
};

// scripts/generate-manifest.ts
var ROOT = path2.resolve(import.meta.dirname, "..");
var BASE_PATH = "/reads/";
var MANIFEST_FILE = "content-manifest.json";
var GENERATED_DIR = "_generated";
var OG_DIR_NAME = "og";
var PAGES_DIR_NAME = "pages";
var contentDir = path2.resolve(process.argv[2] ?? path2.join(ROOT, "content"));
var outputDir = path2.resolve(process.argv[3] ?? path2.join(ROOT, "dist"));
if (!fs2.existsSync(contentDir)) {
  console.error(`Content directory not found: ${contentDir}`);
  process.exit(1);
}
if (!fs2.existsSync(outputDir)) {
  fs2.mkdirSync(outputDir, { recursive: true });
}
var escapeXml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
var escapeAttr = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
var wrapText = (text, maxChars, maxLines) => {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
      continue;
    }
    if (!current) {
      current = `${word.slice(0, maxChars - 1)}…`;
      continue;
    }
    if (lines.length === maxLines - 1) {
      const truncated = current.length <= maxChars - 2 ? `${current}…` : `${current.slice(0, maxChars - 1)}…`;
      lines.push(truncated);
      return lines;
    }
    lines.push(current);
    current = word;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
};
var formatOgDate = (dateStr) => {
  if (!dateStr)
    return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime()))
    return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};
var articleSlug = (articleId) => articleId.replace(/\.md$/i, "");
var siteUrl = () => SITE_CONFIG.url.replace(/\/+$/, "");
var trimSlashes = (s) => {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "/")
    start++;
  while (end > start && s[end - 1] === "/")
    end--;
  return s.slice(start, end);
};
var stripBasePath = (route) => trimSlashes(route.startsWith(BASE_PATH) ? route.slice(BASE_PATH.length) : route);
var generateOgSvg = (article) => {
  const titleLines = wrapText(article.title, 36, 3);
  const descLines = wrapText(article.description, 62, 3);
  const category = article.category.toUpperCase();
  const titleStartY = 170;
  const titleLineHeight = 62;
  const titleTspans = titleLines.map((line, i) => {
    const pos = i === 0 ? `y="${titleStartY}"` : `dy="${titleLineHeight}"`;
    return `<tspan x="80" ${pos}>${escapeXml(line)}</tspan>`;
  }).join(`
      `);
  const titleEndY = titleStartY + (titleLines.length - 1) * titleLineHeight;
  const descStartY = titleEndY + 55;
  const descLineHeight = 32;
  const descTspans = descLines.map((line, i) => {
    const pos = i === 0 ? `y="${descStartY}"` : `dy="${descLineHeight}"`;
    return `<tspan x="80" ${pos}>${escapeXml(line)}</tspan>`;
  }).join(`
      `);
  const dateStr = formatOgDate(article.date);
  const meta = [article.author, dateStr].filter(Boolean).join(" · ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="80" y="65" width="56" height="4" rx="2" fill="#818cf8"/>
  <text x="80" y="106" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="600" fill="#818cf8" letter-spacing="2">✦ ${escapeXml(category)}</text>
  <text font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="#e6edf3">
      ${titleTspans}
  </text>
  <text font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#8b949e" opacity="0.9">
      ${descTspans}
  </text>
  <line x1="80" y1="530" x2="1120" y2="530" stroke="#30363d" stroke-width="1"/>
  <text x="80" y="568" font-family="system-ui, -apple-system, sans-serif" font-size="19" fill="#8b949e">${escapeXml(meta)}</text>
</svg>`;
};
var generateSiteOgSvg = () => {
  const title = SITE_CONFIG.header.title;
  const subtitle = SITE_CONFIG.header.subtitle;
  const heroLines = wrapText(SITE_CONFIG.home.heroTitle, 36, 3);
  const heroStartY = 200;
  const heroLineHeight = 62;
  const heroTspans = heroLines.map((line, i) => {
    const pos = i === 0 ? `y="${heroStartY}"` : `dy="${heroLineHeight}"`;
    return `<tspan x="80" ${pos}>${escapeXml(line)}</tspan>`;
  }).join(`
      `);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="80" y="85" width="56" height="4" rx="2" fill="#818cf8"/>
  <text x="80" y="140" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="#e6edf3">${escapeXml(title)}</text>
  <text x="232" y="140" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#8b949e" dominant-baseline="alphabetic">${escapeXml(subtitle)}</text>
  <text font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="#e6edf3">
      ${heroTspans}
  </text>
  <line x1="80" y1="530" x2="1120" y2="530" stroke="#30363d" stroke-width="1"/>
  <text x="80" y="568" font-family="system-ui, -apple-system, sans-serif" font-size="19" fill="#8b949e">${escapeXml(SITE_CONFIG.url)}</text>
</svg>`;
};
var generateOgImages = (articles, outDir) => {
  const ogDir = path2.join(outDir, GENERATED_DIR, OG_DIR_NAME);
  let count = 0;
  const siteSvgPath = path2.join(ogDir, "site.svg");
  fs2.mkdirSync(path2.dirname(siteSvgPath), { recursive: true });
  fs2.writeFileSync(siteSvgPath, generateSiteOgSvg(), "utf-8");
  for (const article of articles) {
    if (isUnlistedContentPath(article.id))
      continue;
    const slug = articleSlug(article.id);
    const svgPath = path2.join(ogDir, `${slug}.svg`);
    fs2.mkdirSync(path2.dirname(svgPath), { recursive: true });
    fs2.writeFileSync(svgPath, generateOgSvg(article), "utf-8");
    count++;
  }
  return count;
};
var buildMetaBlock = (props) => {
  const site = siteUrl();
  const lines = [
    `<meta name="description" content="${escapeAttr(props.description)}" />`,
    `<meta property="og:type" content="${props.type}" />`,
    `<meta property="og:title" content="${escapeAttr(props.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(props.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(props.url)}" />`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_CONFIG.header.title)}" />`
  ];
  const hasImage = Boolean(props.image);
  lines.push(`<meta name="twitter:card" content="${hasImage ? "summary_large_image" : "summary"}" />`, `<meta name="twitter:title" content="${escapeAttr(props.title)}" />`, `<meta name="twitter:description" content="${escapeAttr(props.description)}" />`);
  if (props.image) {
    const imageUrl = props.image.startsWith("http") ? props.image : `${site}${props.image}`;
    lines.push(`<meta property="og:image" content="${escapeAttr(imageUrl)}" />`, `<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`, `<meta property="og:image:type" content="image/png" />`, `<meta name="twitter:image" content="${escapeAttr(imageUrl)}" />`);
  }
  if (props.author) {
    lines.push(`<meta name="author" content="${escapeAttr(props.author)}" />`);
  }
  if (props.publishedTime) {
    lines.push(`<meta property="article:published_time" content="${escapeAttr(props.publishedTime)}" />`);
  }
  if (props.tags?.length) {
    for (const tag of props.tags) {
      lines.push(`<meta property="article:tag" content="${escapeAttr(tag)}" />`);
    }
  }
  return lines.join(`
    `);
};
var stripSiteMeta = (html) => html.replaceAll(/\s*<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*\/>/g, "").replaceAll(/\n\s*\n/g, `
`);
var injectMeta = (html, title, metaBlock) => stripSiteMeta(html).replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`).replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />', `<meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaBlock}`);
var generateArticlePages = (manifest, outDir) => {
  const indexPath = path2.join(outDir, "index.html");
  if (!fs2.existsSync(indexPath)) {
    console.warn("index.html not found in output dir — skipping per-article HTML generation");
    return 0;
  }
  const baseHtml = fs2.readFileSync(indexPath, "utf-8");
  const site = siteUrl();
  let count = 0;
  for (const article of manifest.articles) {
    if (isUnlistedContentPath(article.id))
      continue;
    const relative = stripBasePath(article.route);
    if (!relative)
      continue;
    const slug = articleSlug(article.id);
    const ogImagePath = `/${GENERATED_DIR}/${OG_DIR_NAME}/${slug}.png`;
    const pageTitle = `${article.title} | ${SITE_CONFIG.header.title}`;
    const articleUrl = `${site}/${relative}/`;
    const meta = buildMetaBlock({
      title: article.title,
      description: article.description,
      url: articleUrl,
      type: "article",
      image: article.cover || ogImagePath,
      author: article.author,
      publishedTime: article.date || undefined,
      tags: article.tags
    });
    const html = injectMeta(baseHtml, pageTitle, meta);
    const articleDir = path2.join(outDir, GENERATED_DIR, PAGES_DIR_NAME, relative);
    fs2.mkdirSync(articleDir, { recursive: true });
    fs2.writeFileSync(path2.join(articleDir, "index.html"), html);
    count++;
  }
  return count;
};
var manifest = buildManifest(contentDir, BASE_PATH);
var manifestPath = path2.join(outputDir, MANIFEST_FILE);
fs2.writeFileSync(manifestPath, serializeManifest(manifest), "utf-8");
console.log(`Manifest: ${manifest.articles.length} articles → ${manifestPath}`);
var ogCount = generateOgImages(manifest.articles, outputDir);
console.log(`OG images: ${ogCount} SVGs → ${path2.join(outputDir, GENERATED_DIR, OG_DIR_NAME)}/`);
var pageCount = generateArticlePages(manifest, outputDir);
if (pageCount > 0) {
  console.log(`HTML pages: ${pageCount} articles with OG meta tags`);
}
