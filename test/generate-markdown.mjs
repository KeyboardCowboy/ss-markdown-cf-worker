import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const htmlPath = path.join(rootDir, "test", "page.html");
const outPath = path.join(rootDir, "test", "output.md");

const html = await readFile(htmlPath, "utf8");

const mf = new Miniflare({
  scriptPath: path.join(rootDir, "src", "index.js"),
  modules: true,
  bindings: {
    TEST_HTML: html,
  },
});

const res = await mf.dispatchFetch(
  "http://local.test/ghosts-spirits?format=markdown",
);

if (!res.ok) {
  const text = await res.text().catch(() => "");
  throw new Error(`Worker returned ${res.status} ${res.statusText}\n${text}`);
}

const md = await res.text();

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, md, "utf8");

console.log(`Wrote ${outPath}`);

