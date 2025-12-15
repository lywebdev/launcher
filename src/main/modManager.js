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
    const mods = await this._getRepoMods();
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

  async _getRepoMods() {
    await this.ensureRepoReady();
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

  async ensureRepoReady() {
    if (!this.repoConfig.zipUrl) {
      throw new Error('modsRepo.zipUrl не настроен');
    }
    if (this.repoRoot && (await fileExists(this.repoRoot))) {
      return this.repoRoot;
    }

    const repoFolder = path.join(this.runtimeDir, 'mods-repo');
    await ensureDir(repoFolder);
    const expectedRoot = path.join(repoFolder, this.repoConfig.subfolder || '');
    if (await fileExists(expectedRoot)) {
      this.repoRoot = expectedRoot;
      this.repoModsCache = null;
      return this.repoRoot;
    }

    const zipPath = path.join(repoFolder, 'repo.zip');
    await this._download(this.repoConfig.zipUrl, zipPath);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(repoFolder, false);

    if (this.repoConfig.subfolder) {
      this.repoRoot = expectedRoot;
    } else {
      const firstEntry = zip.getEntries().find((entry) => entry.isDirectory);
      const baseDir = firstEntry ? firstEntry.entryName.split('/')[0] : '';
      this.repoRoot = path.join(repoFolder, baseDir);
    }

    if (!(await fileExists(this.repoRoot))) {
      throw new Error('Не удалось подготовить репозиторий модов');
    }
    this.repoModsCache = null;
    return this.repoRoot;
  }

  async _download(url, destination) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Ошибка загрузки ${url}: ${response.status}`);
    }
    await pipeline(response.body, fs.createWriteStream(destination));
  }
}

module.exports = ModManager;
