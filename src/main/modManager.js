const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');

const ensureDir = async (dir) => fs.promises.mkdir(dir, { recursive: true });
const fileExists = async (p) => !!(await fs.promises.stat(p).catch(() => null));

class ModManager {
  constructor(minecraftDir, runtimeDir, repoConfig = {}) {
    this.minecraftDir = minecraftDir;
    this.runtimeDir = runtimeDir;
    this.repoConfig = repoConfig;
    this.repoRoot = null;
    this.repoModsCache = null;
    this.repoFolder = path.join(this.runtimeDir, 'mods-repo');
    this.repoMetaPath = path.join(this.repoFolder, 'repo-meta.json');
    this.remoteSignatureCache = null;
    this.remoteSignatureCacheTime = 0;
  }

  async getStatuses() {
    const modsFolder = path.join(this.minecraftDir, 'mods');
    await ensureDir(modsFolder);
    const mods = await this._getRepoMods();
    return Promise.all(
      mods.map(async (mod) => ({
        name: mod.name,
        fileName: mod.fileName,
        installed: await fileExists(path.join(modsFolder, mod.fileName))
      }))
    );
  }

  async sync(options = {}) {
    const { force = false, onProgress } = options;
    const modsFolder = path.join(this.minecraftDir, 'mods');
    await ensureDir(modsFolder);
    const mods = await this._getRepoMods(force);
    const statuses = [];

    for (const mod of mods) {
      const destination = path.join(modsFolder, mod.fileName);
      const installed = await fileExists(destination);
      const needsCopy = force || !installed;
      if (needsCopy) {
        onProgress &&
          onProgress({ fileName: mod.fileName, name: mod.name, state: 'installing', percent: 0 });
        await ensureDir(path.dirname(destination));
        await fs.promises.copyFile(mod.sourcePath, destination);
        onProgress &&
          onProgress({ fileName: mod.fileName, name: mod.name, state: 'done', percent: 100 });
      } else {
        onProgress &&
          onProgress({ fileName: mod.fileName, name: mod.name, state: 'skipped', percent: 100 });
      }
      const finalState = await fileExists(destination);
      statuses.push({ name: mod.name, fileName: mod.fileName, installed: finalState });
    }

    return statuses;
  }

  async deleteMod(fileName) {
    if (!fileName) return this.getStatuses();
    const safeName = path.basename(fileName);
    const modsFolder = path.join(this.minecraftDir, 'mods');
    await ensureDir(modsFolder);
    const target = path.join(modsFolder, safeName);
    await fs.promises.unlink(target).catch((err) => {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    });
    return this.getStatuses();
  }

  async deleteAllMods() {
    const modsFolder = path.join(this.minecraftDir, 'mods');
    await ensureDir(modsFolder);
    const entries = await fs.promises.readdir(modsFolder, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
          await fs.promises.unlink(path.join(modsFolder, entry.name)).catch(() => {});
        }
      })
    );
    return this.getStatuses();
  }

  async _getRepoMods(forceRefresh = false) {
    await this.ensureRepoReady(forceRefresh);
    if (this.repoModsCache) {
      return this.repoModsCache;
    }
    const jars = [];
    await this._walkRepo(this.repoRoot, '', async (fullPath, relativePath) => {
      const fileName = path.basename(relativePath);
      jars.push({
        name: fileName,
        fileName,
        sourcePath: fullPath
      });
    });
    this.repoModsCache = jars;
    return jars;
  }

  async _walkRepo(current, relative, onFile) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const nextRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await this._walkRepo(fullPath, nextRelative, onFile);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
        await onFile(fullPath, nextRelative);
      }
    }
  }

  async ensureRepoReady(forceRefresh = false) {
    if (!this.repoConfig.zipUrl) {
      throw new Error('modsRepo.zipUrl не настроен');
    }
    await ensureDir(this.repoFolder);
    const expectedRoot = path.join(this.repoFolder, this.repoConfig.subfolder || '');
    const needsUpdate =
      forceRefresh ||
      !(await fileExists(expectedRoot)) ||
      (await this._needsRepoUpdate());

    if (needsUpdate) {
      await this._refreshRepo(expectedRoot);
      this.repoModsCache = null;
    } else {
      this.repoRoot = expectedRoot;
    }

    return this.repoRoot;
  }

  async _refreshRepo(expectedRoot) {
    await fs.promises.rm(this.repoFolder, { recursive: true, force: true }).catch(() => {});
    await ensureDir(this.repoFolder);
    const zipPath = path.join(this.repoFolder, 'repo.zip');
    const headers = await this._download(this.repoConfig.zipUrl, zipPath);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(this.repoFolder, false);
    await fs.promises.unlink(zipPath).catch(() => {});

    if (this.repoConfig.subfolder) {
      this.repoRoot = expectedRoot;
    } else {
      const firstEntry = zip.getEntries().find((entry) => entry.isDirectory);
      const baseDir = firstEntry ? firstEntry.entryName.split('/')[0] : '';
      this.repoRoot = path.join(this.repoFolder, baseDir);
    }

    if (!(await fileExists(this.repoRoot))) {
      throw new Error('Не удалось подготовить репозиторий модов');
    }

    const signature = this._extractSignatureFromHeaders(headers) || Date.now().toString();
    await fs.promises
      .writeFile(
        this.repoMetaPath,
        JSON.stringify({ signature, updatedAt: Date.now() }, null, 2),
        'utf-8'
      )
      .catch(() => {});

    return this.repoRoot;
  }

  async _needsRepoUpdate() {
    const meta = await this._readRepoMeta();
    if (!meta || !meta.signature) {
      return true;
    }
    const remoteSignature = await this._fetchRemoteSignature();
    if (!remoteSignature) {
      return false;
    }
    return meta.signature !== remoteSignature;
  }

  async _readRepoMeta() {
    try {
      const raw = await fs.promises.readFile(this.repoMetaPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _fetchRemoteSignature() {
    const now = Date.now();
    if (this.remoteSignatureCache && now - this.remoteSignatureCacheTime < 60_000) {
      return this.remoteSignatureCache;
    }
    try {
      const response = await fetch(this.repoConfig.zipUrl, { method: 'HEAD' });
      if (!response.ok) {
        return null;
      }
      const signature = this._extractSignatureFromHeaders(response.headers);
      this.remoteSignatureCache = signature;
      this.remoteSignatureCacheTime = now;
      return signature;
    } catch {
      return null;
    }
  }

  _extractSignatureFromHeaders(headers) {
    if (!headers) {
      return null;
    }
    if (typeof headers.get === 'function') {
      return (
        headers.get('etag') ||
        headers.get('last-modified') ||
        headers.get('content-length') ||
        null
      );
    }
    return (
      headers.etag ||
      headers.lastModified ||
      headers['last-modified'] ||
      headers.contentLength ||
      headers['content-length'] ||
      null
    );
  }

  async _download(url, destination) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Ошибка загрузки ${url}: ${response.status}`);
    }
    await pipeline(response.body, fs.createWriteStream(destination));
    return {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentLength: response.headers.get('content-length')
    };
  }
}

module.exports = ModManager;
