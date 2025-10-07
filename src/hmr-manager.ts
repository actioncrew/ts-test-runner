import * as fs from 'fs';
import * as path from 'path';
import { FSWatcher, watch } from 'chokidar';
import { EventEmitter } from 'events';
import { ViteJasmineConfig } from './vite-jasmine-config';
import { norm } from './utils';
import { ViteConfigBuilder } from './vite-config-builder';
import { glob } from 'glob';
import picomatch from 'picomatch';

// Dynamic import to avoid top-level await issues
let viteBuild: any = null;
async function getViteBuild() {
  if (!viteBuild) {
    const vite = await import('vite');
    viteBuild = vite.build;
  }
  return viteBuild;
}

export interface HmrUpdate {
  type: 'update' | 'full-reload';
  path: string;
  timestamp: number;
  content?: string;
}

export interface FileFilter {
  include?: string[];
  exclude?: string[];
  extensions?: string[];
}

export interface RebuildStats {
  changedFiles: string[];
  rebuiltFiles: string[];
  duration: number;
  timestamp: number;
}

export class HmrManager extends EventEmitter {
  private viteCache: any = null;
  private watcher: FSWatcher | null = null;
  private isRebuilding: boolean = false;
  private rebuildQueue: Set<string> = new Set();
  private directChanges: Set<string> = new Set();
  private allFiles: string[] = [];

  private fileFilter: FileFilter = {
    include: [],
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
    extensions: ['.ts', '.js', '.mjs']
  };

  private dependencyGraph: Map<string, Set<string>> = new Map();
  private reverseDependencyGraph: Map<string, Set<string>> = new Map();
  private pathAliases: Record<string, string> = {};
  private rebuildMode: 'all' | 'selective' = 'selective';

  constructor(
    private config: ViteJasmineConfig,
    private viteConfigBuilder: ViteConfigBuilder,
    options?: { fileFilter?: Partial<FileFilter>; rebuildMode?: 'all' | 'selective' }
  ) {
    super();
    // NOTE: Assuming viteConfigBuilder.createPathAliases() is public or correctly accessed
    this.pathAliases = (this.viteConfigBuilder as any).createPathAliases();
    if (options?.fileFilter) this.fileFilter = { ...this.fileFilter, ...options.fileFilter };
    if (options?.rebuildMode) this.rebuildMode = options.rebuildMode;
  }

  setFileFilter(filter: Partial<FileFilter>): void {
    this.fileFilter = { ...this.fileFilter, ...filter };
    console.log('✅ File filter updated:', this.fileFilter);
  }

  setRebuildMode(mode: 'all' | 'selective'): void {
    this.rebuildMode = mode;
    console.log(`✅ Rebuild mode set to: ${mode}`);
  }

  private matchesFilter(filePath: string): boolean {
    const normalizedPath = filePath;

    if (this.fileFilter.extensions?.length) {
      const ext = path.extname(normalizedPath);
      if (!this.fileFilter.extensions.includes(ext)) return false;
    }

    if (this.fileFilter.exclude?.length) {
      // Using picomatch for exclude patterns
      if (picomatch.isMatch(normalizedPath, this.fileFilter.exclude)) return false;
    }

    if (this.fileFilter.include?.length) {
      // Using picomatch for include patterns
      if (!picomatch.isMatch(normalizedPath, this.fileFilter.include)) return false;
    }

    return true;
  }

  /**
   * Rebuilds the dependency graph entry for the given files, cleaning up
   * the old reverse dependency entries first.
   */
  private async buildDependencyGraph(files: string[]): Promise<void> {
    for (const file of files) {
      const normalizedFile = norm(file);
      if (!fs.existsSync(file)) {
        // Deletion should be handled by handleFileRemove/handleDirectoryRemove
        this.dependencyGraph.delete(normalizedFile);
        continue;
      }

      // 1. Get the list of dependencies *before* the content is re-parsed
      const oldDeps = this.dependencyGraph.get(normalizedFile);

      // 2. Remove the current file from the reverse sets of its OLD dependencies
      if (oldDeps) {
        for (const oldDep of oldDeps) {
          this.reverseDependencyGraph.get(oldDep)?.delete(normalizedFile);
        }
      }

      // 3. Re-read dependencies (forward link)
      const newDeps = await this.extractDependencies(file);
      this.dependencyGraph.set(normalizedFile, newDeps);

      // 4. Update reverse graph for NEW dependencies
      for (const newDep of newDeps) {
        if (!this.reverseDependencyGraph.has(newDep)) {
          this.reverseDependencyGraph.set(newDep, new Set());
        }
        this.reverseDependencyGraph.get(newDep)!.add(normalizedFile);
      }
    }
  }

  private async extractDependencies(filePath: string): Promise<Set<string>> {
    const deps = new Set<string>();
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const importRegex = /(?:import|export).*?from\s+['"]([^'"]+)['"]/g;
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const resolved = this.resolveImport(filePath, match[1]);
        if (resolved) deps.add(norm(resolved));
      }
      while ((match = requireRegex.exec(content)) !== null) {
        const resolved = this.resolveImport(filePath, match[1]);
        if (resolved) deps.add(norm(resolved));
      }
    } catch (error) {
      console.warn(`⚠️ Could not extract dependencies from ${filePath}:`, (error as Error).message);
    }
    return deps;
  }

  private resolveImport(fromFile: string, importPath: string): string | null {
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      const aliasResolved = this.resolvePathAlias(importPath);
      return aliasResolved || null;
    }

    const dir = path.dirname(fromFile);
    let resolved = path.resolve(dir, importPath);
    const extensions = ['.ts', '.js', '.mjs', '.tsx', '.jsx', '']; // Added TSX/JSX extensions

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;

    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;

      const indexFile = path.join(resolved, `index${ext}`);
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
    }

    return null;
  }

  private resolvePathAlias(importPath: string): string | null {
    const extensions = ['.ts', '.js', '.mjs', '.tsx', '.jsx', '']; // Added TSX/JSX extensions
    for (const [alias, aliasPath] of Object.entries(this.pathAliases)) {
      if (importPath === alias || importPath.startsWith(alias.replace(/\/\*$/, '') + '/')) {
        const relativePart = importPath.slice(alias.replace(/\/\*$/, '').length);
        const resolvedBase = norm(path.join(aliasPath.replace(/\/\*$/, ''), relativePart));
        for (const ext of extensions) {
          const withExt = resolvedBase + ext;
          if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;

          const indexFile = path.join(resolvedBase, `index${ext}`);
          if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
        }
      }
    }
    return null;
  }

  private getFilesToRebuild(changedFile: string): Set<string> {
    const filesToRebuild = new Set<string>();

    if (this.rebuildMode === 'all') return new Set(this.allFiles);

    const queue = [norm(changedFile)];
    const visited = new Set<string>();

    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      filesToRebuild.add(current);

      const dependents = this.reverseDependencyGraph.get(current);
      // Only traverse up to dependent source files and test files
      if (dependents) dependents.forEach(d => queue.push(d));
    }

    return filesToRebuild;
  }

  async start(): Promise<void> {
    this.watcher = watch([this.config.srcDir, this.config.testDir], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', filePath => {
      filePath = norm(filePath);
      if (this.matchesFilter(filePath)) this.queueRebuild(filePath);
    });

    this.watcher.on('add', filePath => {
      filePath = norm(filePath);
      if (this.matchesFilter(filePath)) this.handleFileAdd(filePath);
    });

    this.watcher.on('unlink', filePath => {
      filePath = norm(filePath);
      if (this.matchesFilter(filePath)) this.handleFileRemove(filePath);
    });

    this.watcher.on('addDir', dirPath => this.handleDirectoryAdd(norm(dirPath)));
    this.watcher.on('unlinkDir', dirPath => this.handleDirectoryRemove(norm(dirPath)));

    this.watcher.on('ready', async () => {
      await this.scanAllFiles();
      await this.buildDependencyGraph(this.allFiles);
      console.log(`✅ HMR watching ${this.allFiles.length} files (mode: ${this.rebuildMode})`);
      this.emit('hmr:ready');
    });
  }

  private async scanAllFiles(): Promise<void> {
    const defaultExtensions = this.fileFilter.extensions!.join(',');
    const srcPattern = norm(path.join(this.config.srcDir, `**/*{${defaultExtensions}}`));
    const testPattern = norm(path.join(this.config.testDir, `**/*{${defaultExtensions}}`)); // Include all trackable extensions

    const srcFiles = glob.sync(srcPattern, { absolute: true, ignore: ['**/node_modules/**'] });
    const testFiles = glob.sync(testPattern, { absolute: true, ignore: ['**/node_modules/**'] });

    this.allFiles = [...srcFiles, ...testFiles].filter(f => this.matchesFilter(f));
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    const normalized = norm(filePath);
    if (!this.allFiles.includes(normalized)) {
      this.allFiles.push(normalized);
      console.log(`➕ File added: ${filePath}`);
      await this.buildDependencyGraph([normalized]);
      this.queueRebuild(filePath);
    }
  }

  private handleFileRemove(filePath: string): void {
    const normalized = norm(filePath);
    const affectedFiles = new Set<string>();
    const dependents = this.reverseDependencyGraph.get(normalized);
    dependents?.forEach(d => affectedFiles.add(d));

    this.allFiles = this.allFiles.filter(f => f !== normalized);
    this.dependencyGraph.delete(normalized);
    this.reverseDependencyGraph.delete(normalized);

    for (const deps of this.dependencyGraph.values()) deps.delete(normalized);
    for (const dep of this.reverseDependencyGraph.values()) dep.delete(normalized);

    console.log(`➖ File removed: ${filePath}`);

    if (this.rebuildMode === 'selective' && affectedFiles.size > 0) {
      // Queue a rebuild for dependents who now have a broken import
      affectedFiles.forEach(f => this.queueRebuild(f));
    }
    // Always force full reload on file removal as it breaks the module graph state
    this.emit('hmr:update', { type: 'full-reload', path: normalized, timestamp: Date.now() });
  }

  private async handleDirectoryAdd(dirPath: string): Promise<void> {
    console.log(`📁 Directory added: ${dirPath}`);
    const defaultExtensions = this.fileFilter.extensions!.join(',');
    const pattern = path.join(dirPath, `**/*{${defaultExtensions}}`);
    const newFiles = glob.sync(pattern, { absolute: true, ignore: ['**/node_modules/**'] })
      .filter(f => this.matchesFilter(f));

    const filesToProcess: string[] = [];
    for (const file of newFiles) {
      const normalized = norm(file);
      if (!this.allFiles.includes(normalized)) {
        this.allFiles.push(normalized);
        filesToProcess.push(normalized);
      }
    }

    if (filesToProcess.length) {
      console.log(`📦 Found ${filesToProcess.length} files in new directory`);
      await this.buildDependencyGraph(filesToProcess);
      filesToProcess.forEach(f => this.queueRebuild(f));
    }
  }

  private async handleDirectoryRemove(dirPath: string): Promise<void> {
    console.log(`📁 Directory removed: ${dirPath}`);
    const removedFiles = this.allFiles.filter(f => f.startsWith(dirPath + path.sep) || f === dirPath);
    const affectedFiles = new Set<string>();

    for (const file of removedFiles) {
      const normalized = norm(file);
      const dependents = this.reverseDependencyGraph.get(normalized);
      dependents?.forEach(d => affectedFiles.add(d));

      this.allFiles = this.allFiles.filter(f => f !== normalized);
      this.dependencyGraph.delete(normalized);
      this.reverseDependencyGraph.delete(normalized);

      for (const deps of this.dependencyGraph.values()) deps.delete(normalized);
      for (const dep of this.reverseDependencyGraph.values()) dep.delete(normalized);
    }

    // Always force full reload on directory removal
    this.emit('hmr:update', { type: 'full-reload', path: dirPath, timestamp: Date.now() });

    if (this.rebuildMode === 'selective' && affectedFiles.size > 0) {
      // Queue a rebuild for dependents who now have a broken import
      affectedFiles.forEach(f => this.queueRebuild(f));
    }
  }

  private queueRebuild(filePath: string) {
    const normalized = norm(filePath);
    this.directChanges.add(normalized); // track direct changes only
    this.rebuildQueue.add(normalized);

    if (!this.isRebuilding) this.rebuildAll();
  }

  private async rebuildAll() {
    this.isRebuilding = true;

    try {
      while (this.rebuildQueue.size > 0) {
        const startTime = Date.now();

        const changedFiles = Array.from(this.rebuildQueue);
        this.rebuildQueue.clear();
        this.directChanges.clear();

        const filesToRebuild = new Set<string>();

        for (const file of changedFiles) {
          // Get the file itself + all dependent source files/modules
          const deps = this.getFilesToRebuild(file);
          deps.forEach(f => filesToRebuild.add(f));

          // If the change originated in a source file, ensure its dependent tests are included.
          if (file.startsWith(this.config.srcDir)) {
            // Dependent tests are already included via reverse graph traversal
            // (since tests import sources, tests are dependents of sources).
            // The broad inclusion of all tests has been removed for better selectivity.
          } else if (file.startsWith(this.config.testDir)) {
            // If a test file changed, ensure it's in the rebuild set (already handled by getFilesToRebuild)
          }
        }

        const rebuiltFiles = Array.from(filesToRebuild);

        console.log(`📦 Changed: ${changedFiles.length} files → Rebuilding: ${rebuiltFiles.length} files`);

        // Re-calculate dependencies for all files being rebuilt
        await this.buildDependencyGraph(rebuiltFiles);

        const viteConfig = this.viteConfigBuilder.createViteConfigForFiles(rebuiltFiles, this.viteCache);
        const build = await getViteBuild();
        const result = await build(viteConfig);
        this.viteCache = result;

        for (const file of rebuiltFiles) {
          const relative = this.getOutputName(file);
          const outputPath = path.join(this.config.outDir, relative);

          if (fs.existsSync(outputPath)) {
            const content = fs.readFileSync(outputPath, 'utf-8');
            this.emit('hmr:update', {
              type: 'update',
              path: `/${relative}`,
              timestamp: Date.now(),
              content,
            });
          }
        }

        const duration = Date.now() - startTime;
        this.emit('hmr:rebuild', { changedFiles, rebuiltFiles, duration, timestamp: Date.now() });
        console.log(`✅ Rebuild complete: ${rebuiltFiles.length} files in ${duration}ms`);
      }
    } catch (error) {
      console.error('❌ Rebuild failed:', error);
      this.emit('hmr:error', error);
    } finally {
      this.isRebuilding = false;
    }
  }

  private getOutputName(filePath: string): string {
    const relative = filePath.startsWith(norm(this.config.testDir))
      ? path.relative(this.config.testDir, filePath)
      : path.relative(norm(this.config.srcDir), filePath);

    const ext = path.extname(filePath);
    // Ensure relative path is normalized before replacement
    return norm(relative).replace(ext, '.js').replace(/[\/\\]/g, '_');
  }

  getDependencyInfo(filePath: string) {
    const normalized = norm(filePath);
    return {
      dependencies: Array.from(this.dependencyGraph.get(normalized) || []),
      dependents: Array.from(this.reverseDependencyGraph.get(normalized) || [])
    };
  }

  getStats() {
    return {
      totalFiles: this.allFiles.length,
      trackedDependencies: this.dependencyGraph.size,
      rebuildMode: this.rebuildMode,
      fileFilter: this.fileFilter,
      pathAliases: this.pathAliases
    };
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.dependencyGraph.clear();
      this.reverseDependencyGraph.clear();
      console.log('✅ HMR watcher stopped');
    }
  }
}
