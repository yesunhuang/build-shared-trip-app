import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(root, "assets/app-template/public");
const hostedRoot = path.join(root, "assets/selfhosted");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".json": "application/json" };
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
export const BUILD_VERSION = crypto.createHash("sha256").update(files(publicRoot).concat(fs.existsSync(hostedRoot) ? files(hostedRoot) : []).sort().map((f) => fs.readFileSync(f)).reduce((a,b) => Buffer.concat([a,b]), Buffer.alloc(0))).digest("hex").slice(0,12);
function replace(content) {
  const values = {
    CACHE_VERSION: BUILD_VERSION, APP_NAME_HTML: "Shared Trips", APP_SHORT_NAME_HTML: "Shared Trips",
    META_DESCRIPTION_HTML: "Your shared trips", RESOURCES_DESCRIPTION_HTML: "Travel resources",
    TRIP_DATE_LINE_HTML: "", ROUTE_DECORATION_HTML: "", TRIP_DATA_JSON: "{}",
    FIREBASE_CONFIG_JSON: "{}", FIRESTORE_DOCUMENT_PATH_JSON: JSON.stringify("trips/unused"),
    APP_NAME_JSON: JSON.stringify("Shared Trips"), APP_SHORT_NAME_JSON: JSON.stringify("Shared Trips"),
    META_DESCRIPTION_JSON: JSON.stringify("Your shared trips"), THEME_COLOR_JSON: JSON.stringify("#17362f")
  };
  return content.replace(/__([A-Z_]+)__/g, (all,key) => values[key] ?? all);
}
export function serveStatic(req, res, pathname) {
  let file;
  const tripPage = /^\/trips\/[^/]+\/?$/.test(pathname);
  const resourcePage = pathname === "/resources.html";
  if (pathname === "/" || pathname === "/login" || pathname === "/index.html") file = path.join(hostedRoot, "index.html");
  else if (["/home.js","/home.css","/manifest.webmanifest","/service-worker.js","/offline.html"].includes(pathname)) file = path.join(hostedRoot, pathname.slice(1));
  else if (tripPage) file = path.join(publicRoot, "index.html");
  else {
    file = path.resolve(publicRoot, "." + pathname);
    if (!file.startsWith(publicRoot + path.sep)) return false;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file);
  if (!types[ext]) return false;
  let data = fs.readFileSync(file);
  if ([".html",".js",".css",".webmanifest",".json",".svg"].includes(ext)) {
    let content = replace(data.toString());
    if (tripPage || resourcePage) {
      content = content.replace("</head>", "<script>window.SHARED_TRIP_HOSTED=true;</script></head>");
      content = content.replace('src="/app.js?v=' + BUILD_VERSION + '"', 'src="/hosted-bootstrap.js?v=' + BUILD_VERSION + '"');
      content = content.replace('src="/resources.js?v=' + BUILD_VERSION + '"', 'src="/hosted-resources-bootstrap.js?v=' + BUILD_VERSION + '"');
    }
    data = Buffer.from(content);
  }
  res.setHeader("Content-Type", types[ext] + ([".html",".js",".css",".json",".webmanifest",".svg"].includes(ext) ? "; charset=utf-8" : ""));
  res.setHeader("Cache-Control", ext === ".html" || pathname === "/service-worker.js" ? "no-store" : "public, max-age=0, must-revalidate");
  res.end(req.method === "HEAD" ? undefined : data);
  return true;
}
