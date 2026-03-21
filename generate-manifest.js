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

// scripts/generate-manifest.ts
var ROOT = path2.resolve(import.meta.dirname, "..");
var BASE_PATH = "/reads/";
var MANIFEST_FILE = "content-manifest.json";
var contentDir = path2.resolve(process.argv[2] ?? path2.join(ROOT, "content"));
var outputDir = path2.resolve(process.argv[3] ?? path2.join(ROOT, "dist"));
if (!fs2.existsSync(contentDir)) {
  console.error(`Content directory not found: ${contentDir}`);
  process.exit(1);
}
if (!fs2.existsSync(outputDir)) {
  fs2.mkdirSync(outputDir, { recursive: true });
}
var manifest = buildManifest(contentDir, BASE_PATH);
var outputPath = path2.join(outputDir, MANIFEST_FILE);
fs2.writeFileSync(outputPath, serializeManifest(manifest), "utf-8");
console.log(`Generated ${MANIFEST_FILE} (${manifest.articles.length} articles) → ${outputPath}`);
