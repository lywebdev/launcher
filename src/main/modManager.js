const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { pipeline } = require('stream/promises');

const ensureDir = async (dir) => fs.promises.mkdir(dir, { recursive: true });
const fileExists = async (p) => !!(await fs.promises.stat(p).catch(() => null));

const copyWithProgress = async (source, destination, onProgress) => {
  const stat = await fs.promises.stat(source);
  const totalBytes = stat.size || 0;
  await ensureDir(path.dirname(destination));
  return new Promise((resolve, reject) => {
    let transferred = 0;
    const readStream = fs.createReadStream(source);
    const writeStream = fs.createWriteStream(destination);

    const report = () => {
      if (typeof onProgress === 'function' && totalBytes > 0) {
        const percent = Math.min(100, (transferred / totalBytes) * 100);
        onProgress(percent);
      }
    };

    readStream.on('data', (chunk) => {
      transferred += chunk.length;
      report();
    });
    readStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });
    writeStream.on('error', (err) => {
      readStream.destroy();
      reject(err);
    });
    writeStream.on('finish', () => {
      report();
      resolve();
    });
    readStream.pipe(writeStream);
  });
};

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
    const mods = await this._getRepoMods(force, (repoPayload) => {
      onProgress &&
        onProgress({
          scope: 'repo',
          ...repoPayload
        });
    });
    onProgress && onProgress({ scope: 'repo', state: 'done', percent: 100 });
    const statuses = [];

    for (const mod of mods) {
      const destination = path.join(modsFolder, mod.fileName);
      const installed = await fileExists(destination);
      const needsCopy = force || !installed;
      if (needsCopy) {
        onProgress &&
          onProgress({ fileName: mod.fileName, name: mod.name, state: 'installing', percent: 0 });
        await copyWithProgress(mod.sourcePath, destination, (percent) =>
          onProgress &&
          onProgress({
            fileName: mod.fileName,
            name: mod.name,
            state: 'installing',
            percent
          })
        );
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

  async installMod(fileName, onProgress) {
    if (!fileName) {
      throw new Error('Не указан мод');
    }
    await this.ensureRepoReady();
    const mods = await this._getRepoMods();
    const targetMod = mods.find((mod) => mod.fileName === fileName);
    if (!targetMod) {
      throw new Error('Мод не найден в репозитории');
    }
    const modsFolder = path.join(this.minecraftDir, 'mods');
    await ensureDir(modsFolder);
    const destination = path.join(modsFolder, targetMod.fileName);
    onProgress &&
      onProgress({ fileName: targetMod.fileName, name: targetMod.name, state: 'installing', percent: 0 });
    await copyWithProgress(targetMod.sourcePath, destination, (percent) => {
      onProgress &&
        onProgress({
          fileName: targetMod.fileName,
          name: targetMod.name,
          state: 'installing',
          percent
        });
    });
    onProgress &&
      onProgress({ fileName: targetMod.fileName, name: targetMod.name, state: 'done', percent: 100 });
    return this.getStatuses();
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

  async _getRepoMods(forceRefresh = false, onRepoProgress) {
    await this.ensureRepoReady(forceRefresh, onRepoProgress);
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

  async ensureRepoReady(forceRefresh = false, onRepoProgress) {
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
      await this._refreshRepo(expectedRoot, onRepoProgress);
      this.repoModsCache = null;
    } else {
      this.repoRoot = expectedRoot;
    }

    return this.repoRoot;
  }

  async _refreshRepo(expectedRoot, onRepoProgress) {
    await fs.promises.rm(this.repoFolder, { recursive: true, force: true }).catch(() => {});
    await ensureDir(this.repoFolder);
    const zipPath = path.join(this.repoFolder, 'repo.zip');
    const headers = await this._download(this.repoConfig.zipUrl, zipPath, (downloaded, total) =>
      onRepoProgress &&
      onRepoProgress({
        state: 'download',
        percent: total ? Math.min(100, (downloaded / total) * 100) : 0
      })
    );
    await this._extractZipWithProgress(zipPath, this.repoFolder, (current, total) => {
      if (onRepoProgress) {
        const percent = total ? Math.min(100, (current / total) * 100) : 0;
        onRepoProgress({ state: 'extract', percent });
      }
    });
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

  async _download(url, destination, onChunk) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Ошибка загрузки ${url}: ${response.status}`);
    }
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(destination);
      let downloaded = 0;
      response.body.on('data', (chunk) => {
        downloaded += chunk.length;
        onChunk && onChunk(downloaded, Number(response.headers.get('content-length') || 0));
      });
      response.body.on('error', (error) => {
        fileStream.destroy();
        reject(error);
      });
      fileStream.on('finish', resolve);
      response.body.pipe(fileStream);
    });
    return {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentLength: response.headers.get('content-length')
    };
  }

  async _extractZipWithProgress(zipPath, outputDir, onProgress) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const total = entries.length || 1;
    let processed = 0;
    for (const entry of entries) {
      const entryPath = path.join(outputDir, entry.entryName);
      if (entry.isDirectory) {
        await ensureDir(entryPath).catch(() => {});
      } else {
        await ensureDir(path.dirname(entryPath));
        await fs.promises.writeFile(entryPath, entry.getData());
      }
      processed += 1;
      if (onProgress) {
        onProgress(processed, total);
      }
    }
    return total;
  }
}

module.exports = ModManager;
