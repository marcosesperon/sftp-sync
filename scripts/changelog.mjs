// Extrae del CHANGELOG.md la sección de una versión y la imprime por stdout.
// Uso: node scripts/changelog.mjs 0.2.0
import { readFileSync } from "node:fs";

const version = (process.argv[2] || "").trim().replace(/^v/, "");
let md = "";
try {
  md = readFileSync("CHANGELOG.md", "utf8");
} catch {
  /* sin changelog */
}

const out = [];
let capturing = false;
for (const line of md.split("\n")) {
  const isHeading = /^##\s/.test(line);
  if (isHeading) {
    if (capturing) break; // siguiente versión: paramos
    if (version && line.includes(version)) {
      capturing = true;
      continue;
    }
  } else if (capturing) {
    out.push(line);
  }
}

let body = out.join("\n").trim();
if (!body) {
  body = `Versión ${version}. Ver los binarios adjuntos más abajo.`;
}
process.stdout.write(body);
