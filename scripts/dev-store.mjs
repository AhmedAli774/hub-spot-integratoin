/**
 * Dev-store — file-based JSON persistence for local development.
 * Replaces Wix Data collections when running outside the Wix platform.
 */
import fs from 'fs/promises';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), '.dev-store');

async function ensureDir() {
  try { await fs.mkdir(STORE_DIR, { recursive: true }); } catch {}
}

async function readJson(filename) {
  await ensureDir();
  const filepath = path.join(STORE_DIR, `${filename}.json`);
  try {
    const raw = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeJson(filename, data) {
  await ensureDir();
  const filepath = path.join(STORE_DIR, `${filename}.json`);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

/**
 * Simple key-value store (maps, tokens, etc.)
 */
export const store = {
  async get(filename, key) {
    const data = await readJson(filename);
    return data[key] ?? null;
  },

  async set(filename, key, value) {
    const data = await readJson(filename);
    data[key] = value;
    await writeJson(filename, data);
  },

  async remove(filename, key) {
    const data = await readJson(filename);
    delete data[key];
    await writeJson(filename, data);
  },

  async all(filename) {
    const data = await readJson(filename);
    return Object.values(data);
  },

  async query(filename, opts = {}) {
    const items = await this.all(filename);
    let result = items;
    if (opts.sortBy) {
      result = result.sort((a, b) => {
        const av = a[opts.sortBy] ?? 0;
        const bv = b[opts.sortBy] ?? 0;
        return opts.descending ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
      });
    }
    const limit = opts.limit ?? 50;
    return result.slice(0, limit);
  },
};

/**
 * Array-based log store (append-only, auto-timestamp)
 */
export const logStore = {
  async append(filename, entry) {
    const data = await readJson(filename);
    if (!Array.isArray(data.items)) data.items = [];
    data.items.push({ ...entry, _createdDate: new Date().toISOString() });
    await writeJson(filename, data);
  },

  async list(filename, opts = {}) {
    const data = await readJson(filename);
    const items = Array.isArray(data.items) ? data.items : [];
    let result = items.sort((a, b) => {
      const at = new Date(a._createdDate || 0).getTime();
      const bt = new Date(b._createdDate || 0).getTime();
      return bt - at; // descending
    });
    const limit = opts.limit ?? 50;
    return result.slice(0, limit);
  },
};

