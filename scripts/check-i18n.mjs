/**
 * Guards the translation dictionary:
 *   1. every t("key") used in src resolves to an entry
 *   2. every entry carries all three languages
 *   3. reports entries nothing references any more
 *
 * Run: node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = "frontend/src";
const DICT = path.join(SRC, "context/LanguageContext.tsx");
const LANGS = ["tr", "en", "ar"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.tsx?$/.test(name)
        ? [full]
        : [];
  });
}

const dictSrc = readFileSync(DICT, "utf8");

// Values may contain literal braces ({n}, {status} placeholders), so match up
// to the closing brace that ends a line rather than the first one seen.
const defined = new Map();
for (const m of dictSrc.matchAll(/^\s*"([\w.]+)":\s*\{([\s\S]*?)\},?\s*$/gm)) {
  defined.set(m[1], m[2]);
}

// Key families composed at runtime, e.g. t(`status.${key}`) in StatusChip. The
// literal regex below cannot see these, so the whole prefix counts as used.
const DYNAMIC_PREFIXES = [
  "status.",
  "priority.",
  "chrono.evt.",
  "alerts.type.",
  "alerts.role.",
  "entity.",
  "contract.type.",
  "party.",
  "origin.",
  "discipline.",
  "inforce.path.",
  "dispute.origin.",
  "dispute.impact.",
  "dispute.attach.",
];

const used = new Map();
for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([\w.]+)"\s*\)/g)) {
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(path.relative(SRC, file));
  }
}

let failed = false;

const missing = [...used.keys()].filter((k) => !defined.has(k));
if (missing.length) {
  failed = true;
  console.log(`\nMISSING KEYS (${missing.length}) — these render as raw key text:`);
  for (const k of missing) console.log(`  ${k}  <- ${[...new Set(used.get(k))].join(", ")}`);
}

const incomplete = [...defined.entries()].filter(([, body]) =>
  LANGS.some((l) => !new RegExp(`\\b${l}:`).test(body))
);
if (incomplete.length) {
  failed = true;
  console.log(`\nINCOMPLETE ENTRIES (${incomplete.length}) — missing a language:`);
  for (const [k, body] of incomplete) {
    console.log(`  ${k}  (has: ${LANGS.filter((l) => new RegExp(`\\b${l}:`).test(body)).join(", ")})`);
  }
}

const unused = [...defined.keys()].filter(
  (k) => !used.has(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p))
);
if (unused.length) {
  console.log(`\nUNREFERENCED (${unused.length}) — informational only:`);
  console.log(`  ${unused.join(", ")}`);
}

console.log(
  `\n${defined.size} keys defined, ${used.size} referenced. ${failed ? "FAIL" : "OK"}`
);
process.exit(failed ? 1 : 0);
