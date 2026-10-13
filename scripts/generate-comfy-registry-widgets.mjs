// Generates widget names for ComfyUI nodes from the official Comfy Registry (api.comfy.org).
//
// Development-time only: the app never contacts the Registry. The script downloads every
// `/comfy-nodes` page once into a git-ignored cache, then derives each node's widget list from
// its `input_types` the way ComfyUI's frontend builds widgets, and writes a compact JSON file that
// ships with the app. Re-running reuses the cache; pass --refresh to download again.
//
// Usage: node scripts/generate-comfy-registry-widgets.mjs [--refresh] [--concurrency=4]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const REGISTRY_URL = 'https://api.comfy.org/comfy-nodes';
const CACHE_DIR = '.cache/comfy-registry';
const OUTPUT_PATH = 'src/features/viewer/components/workflowCanvas/registryWidgetNames.json';
const MAX_ATTEMPTS = 6;

/** Widget kinds: i INT, I INT with a seed control widget, f FLOAT, s STRING, b BOOLEAN, c COMBO, u upload button. */
const PRIMITIVE_KINDS = { INT: 'i', FLOAT: 'f', STRING: 's', BOOLEAN: 'b' };
const UPLOAD_OPTIONS = ['image_upload', 'video_upload', 'audio_upload', 'animated_image_upload', 'upload'];
const LEGACY_SEED_NAMES = new Set(['seed', 'noise_seed']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Ordered input entries: required then optional, honoring `input_order` when the definition has it. */
const orderedInputs = (inputTypes) => {
  const entries = [];
  for (const section of ['required', 'optional']) {
    const inputs = inputTypes[section];
    if (!isRecord(inputs)) continue;
    const order = isRecord(inputTypes.input_order) && Array.isArray(inputTypes.input_order[section])
      ? inputTypes.input_order[section].filter((name) => name in inputs)
      : Object.keys(inputs);
    for (const name of order) entries.push([name, inputs[name]]);
  }
  return entries;
};

/**
 * Widgets ComfyUI creates for a node definition, in `widgets_values` order. Link-type inputs and
 * `forceInput` primitives are sockets, not widgets; combos with an upload option add the upload
 * button widget right after them, and seed INTs get the unserialized-name control widget (kind I).
 */
export const deriveWidgets = (inputTypes) => {
  if (!isRecord(inputTypes)) return [];
  const widgets = [];
  for (const [name, spec] of orderedInputs(inputTypes)) {
    const [type, options] = Array.isArray(spec) ? spec : [spec, undefined];
    const opts = isRecord(options) ? options : {};
    let kind;
    if (Array.isArray(type) || type === 'COMBO') kind = 'c';
    else if (typeof type === 'string' && type in PRIMITIVE_KINDS) kind = PRIMITIVE_KINDS[type];
    else continue;
    if (kind !== 'c' && opts.forceInput === true) continue;
    if (kind === 'i' && (opts.control_after_generate === true || LEGACY_SEED_NAMES.has(name))) kind = 'I';
    widgets.push({ name, kind });
    if (kind === 'c' && UPLOAD_OPTIONS.some((option) => opts[option] === true)) widgets.push({ name: 'upload', kind: 'u' });
  }
  return widgets;
};

/**
 * Builds the shipped table: a shared name list plus, per node type, every distinct widget variant
 * seen across pack versions (most common first). A variant is `[kinds, ...nameIndexes]`.
 */
export const buildWidgetTable = (comfyNodes) => {
  const variantsByNode = new Map();
  let skipped = 0;
  for (const node of comfyNodes) {
    const nodeName = node?.comfy_node_name;
    if (typeof nodeName !== 'string' || !nodeName || typeof node.input_types !== 'string') {
      skipped += 1;
      continue;
    }
    let inputTypes;
    try {
      inputTypes = JSON.parse(node.input_types);
    } catch {
      skipped += 1;
      continue;
    }
    const widgets = deriveWidgets(inputTypes);
    if (widgets.length === 0) continue;
    const key = widgets.map((widget) => `${widget.kind}:${widget.name}`).join('\u0001');
    const variants = variantsByNode.get(nodeName) ?? new Map();
    const variant = variants.get(key) ?? { widgets, count: 0 };
    variant.count += 1;
    variants.set(key, variant);
    variantsByNode.set(nodeName, variants);
  }

  const names = [];
  const nameIndex = new Map();
  const indexOf = (name) => {
    if (!nameIndex.has(name)) {
      nameIndex.set(name, names.length);
      names.push(name);
    }
    return nameIndex.get(name);
  };
  const nodes = {};
  for (const nodeName of [...variantsByNode.keys()].sort()) {
    nodes[nodeName] = [...variantsByNode.get(nodeName).values()]
      .sort((a, b) => b.count - a.count)
      .map(({ widgets }) => [widgets.map((widget) => widget.kind).join(''), ...widgets.map((widget) => indexOf(widget.name))]);
  }
  return { names, nodes, skipped };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchPage = async (page) => {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${REGISTRY_URL}?page=${page}&pageSize=100`, { headers: { accept: 'application/json' } });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Registry page ${page} failed: HTTP ${response.status}`);
  }
};

/** Downloads every page into the cache (skipping pages already cached) and returns all entries. */
const downloadAll = async ({ cacheDir, refresh, concurrency }) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  const pagePath = (page) => path.join(cacheDir, `page-${String(page).padStart(5, '0')}.json`);
  const readCached = (page) => JSON.parse(fs.readFileSync(pagePath(page), 'utf8'));
  const load = async (page) => {
    if (!refresh && fs.existsSync(pagePath(page))) return readCached(page);
    const body = await fetchPage(page);
    fs.writeFileSync(pagePath(page), JSON.stringify(body));
    return body;
  };

  const first = await load(1);
  const pageSize = first.page_size || 100;
  const pages = Math.ceil((first.total ?? 0) / pageSize);
  console.log(`Registry reports ${first.total} comfy nodes in ${pages} pages of ${pageSize}.`);

  const entries = [...(first.comfy_nodes ?? [])];
  let next = 2;
  let done = 1;
  const worker = async () => {
    while (next <= pages) {
      const page = next;
      next += 1;
      const body = await load(page);
      entries.push(...(body.comfy_nodes ?? []));
      done += 1;
      if (done % 200 === 0 || done === pages) console.log(`  ${done}/${pages} pages`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { entries, total: first.total ?? entries.length };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const refresh = process.argv.includes('--refresh');
    const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
    const concurrency = Math.max(1, Math.min(8, Number(concurrencyArg?.split('=')[1]) || 4));
    const { entries, total } = await downloadAll({ cacheDir: path.join(process.cwd(), CACHE_DIR), refresh, concurrency });
    const { names, nodes, skipped } = buildWidgetTable(entries);
    const output = {
      source: REGISTRY_URL,
      generatedAt: new Date().toISOString().slice(0, 10),
      registryEntries: total,
      downloadedEntries: entries.length,
      names,
      nodes
    };
    fs.writeFileSync(path.join(process.cwd(), OUTPUT_PATH), `${JSON.stringify(output)}\n`);
    console.log(`Wrote ${Object.keys(nodes).length} node types (${names.length} distinct widget names) to ${OUTPUT_PATH}; skipped ${skipped} entries without usable input_types.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
