import * as fs from 'fs';
import * as path from 'path';
import { FSWatcher, watch } from 'chokidar';
import { EventEmitter } from 'events';
import { ViteJasmineConfig } from './vite-jasmine-config';
import { capitalize, norm } from './utils';
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
  type: 'update' | 'full-reload' | 'test-update';
  path: string;
  timestamp: number;
  content?: string;
  affectedTests?: string[];
  reason?: string;
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
  updateType: 'test-only' | 'source-change' | 'full';
}

export type SourceChangeStrategy = 'smart' | 'always-reload' | 'never-reload';

export interface HmrManagerOptions {
  fileFilter?: Partial<FileFilter>;
  rebuildMode?: 'all' | 'selective';
  sourceChangeStrategy?: SourceChangeStrategy;
  criticalSourcePatterns?: string[]; // patterns that always trigger full reload
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
  private sourceChangeStrategy: SourceChangeStrategy = 'smart';
  private criticalSourcePatterns: string[] = [
    '**/config/**',
    '**/setup/**',
    '**/*.config.*',
    '**/bootstrap.*',
    '**/main.*',
    '**/index.*' // root-level index files
  ];

  constructor(
    private config: ViteJasmineConfig,
    private viteConfigBuilder: ViteConfigBuilder,
    options?: HmrManagerOptions
  ) {
    super();
    this.pathAliases = (this.viteConfigBuilder as any).createPathAliases();
    if (options?.fileFilter) this.fileFilter = { ...this.fileFilter, ...options.fileFilter };
    if (options?.rebuildMode) this.rebuildMode = options.rebuildMode;
    if (options?.sourceChangeStrategy) this.sourceChangeStrategy = options.sourceChangeStrategy;
    if (options?.criticalSourcePatterns) {
      this.criticalSourcePatterns = [...this.criticalSourcePatterns, ...options.criticalSourcePatterns];
    }
  }

  setFileFilter(filter: Partial<FileFilter>): void {
    this.fileFilter = { ...this.fileFilter, ...filter };
    console.log('✅ File filter updated:', this.fileFilter);
  }

  setRebuildMode(mode: 'all' | 'selective'): void {
    this.rebuildMode = mode;
    console.log(`✅ Rebuild mode set to: ${mode}`);
  }

  setSourceChangeStrategy(strategy: SourceChangeStrategy): void {
    this.sourceChangeStrategy = strategy;
    console.log(`✅ Source change strategy set to: ${strategy}`);
  }

  private matchesFilter(filePath: string): boolean {
    const normalizedPath = filePath;

    if (this.fileFilter.extensions?.length) {
      const ext = path.extname(normalizedPath);
      if (!this.fileFilter.extensions.includes(ext)) return false;
    }

    if (this.fileFilter.exclude?.length) {
      if (picomatch.isMatch(normalizedPath, this.fileFilter.exclude)) return false;
    }

    if (this.fileFilter.include?.length) {
      if (!picomatch.isMatch(normalizedPath, this.fileFilter.include)) return false;
    }

    return true;
  }

  /**
   * Determines if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const normalized = norm(filePath);
    return normalized.startsWith(this.config.testDir);
  }

  /**
   * Determines if a file is a source file
   */
  private isSourceFile(filePath: string): boolean {
    const normalized = norm(filePath);
    return normalized.startsWith(this.config.srcDir);
  }

  /**
   * Checks if a source file is critical and requires full reload
   */
  private isCriticalSourceFile(filePath: string): boolean {
    if (!this.isSourceFile(filePath)) return false;
    
    const normalized = norm(filePath);
    return this.criticalSourcePatterns.some(pattern => 
      picomatch.isMatch(normalized, pattern)
    );
  }

  /**
   * Determines the appropriate update strategy based on what changed
   */
  private determineUpdateStrategy(
    changedFiles: string[],
    changeType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  ): { type: HmrUpdate['type']; reason: string } {
    const hasSourceChanges = changedFiles.some(f => this.isSourceFile(f));
    const hasTestChanges = changedFiles.some(f => this.isTestFile(f));
    const hasCriticalChanges = changedFiles.some(f => this.isCriticalSourceFile(f));

    // Test-only changes never require full reload
    if (!hasSourceChanges && hasTestChanges) {
      return {
        type: 'test-update',
        reason: 'Test files changed - incremental update'
      };
    }

    // Source file/directory removal - check if critical
    if (changeType === 'unlink' || changeType === 'unlinkDir') {
      if (hasCriticalChanges) {
        return {
          type: 'full-reload',
          reason: 'Critical source file/directory removed'
        };
      }
      // Non-critical source removal can be handled with update
      return {
        type: 'update',
        reason: 'Source file/directory removed - updating dependents'
      };
    }

    // Source file/directory addition
    if (changeType === 'add' || changeType === 'addDir') {
      // New sources don't require full reload, just build them
      return {
        type: 'update',
        reason: 'Source file/directory added - building new modules'
      };
    }

    // Source file modification - apply strategy
    if (hasSourceChanges) {
      if (this.sourceChangeStrategy === 'always-reload') {
        return {
          type: 'full-reload',
          reason: 'Source changed - always-reload strategy'
        };
      }

      if (this.sourceChangeStrategy === 'never-reload') {
        return {
          type: 'update',
          reason: 'Source changed - never-reload strategy'
        };
      }

      // Smart strategy
      if (hasCriticalChanges) {
        return {
          type: 'full-reload',
          reason: 'Critical source file changed'
        };
      }

      return {
        type: 'update',
        reason: 'Source changed - incremental update'
      };
    }

    // Default to update
    return {
      type: 'update',
      reason: 'General update'
    };
  }

  /**
   * Rebuilds the dependency graph entry for the given files
   */
  private async buildDependencyGraph(files: string[]): Promise<void> {
    for (const file of files) {
      const normalizedFile = norm(file);
      if (!fs.existsSync(file)) {
        this.dependencyGraph.delete(normalizedFile);
        continue;
      }

      const oldDeps = this.dependencyGraph.get(normalizedFile);

      if (oldDeps) {
        for (const oldDep of oldDeps) {
          this.reverseDependencyGraph.get(oldDep)?.delete(normalizedFile);
        }
      }

      const newDeps = await this.extractDependencies(file);
      this.dependencyGraph.set(normalizedFile, newDeps);

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
    const extensions = [...this.fileFilter.extensions!, ''];

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
    const extensions = [...this.fileFilter.extensions!, ''];
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
      if (dependents) dependents.forEach(d => queue.push(d));
    }

    return filesToRebuild;
  }

  /**
   * Gets all test files affected by a source change
   */
  private getAffectedTests(sourceFile: string): string[] {
    const allDependents = this.getFilesToRebuild(sourceFile);
    return Array.from(allDependents).filter(f => this.isTestFile(f));
  }

  async start(): Promise<void> {
    this.watcher = watch([this.config.srcDir, this.config.testDir], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', filePath => {
      filePath = norm(filePath);
      if (this.matchesFilter(filePath)) this.queueRebuild(filePath, 'change');
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
      console.log(`✅ HMR watching ${this.allFiles.length} files (mode: ${this.rebuildMode}, strategy: ${this.sourceChangeStrategy})`);
      this.emit('hmr:ready');
    });
  }

  private async scanAllFiles(): Promise<void> {
    const defaultExtensions = this.fileFilter.extensions!.join(',');
    const srcPattern = norm(path.join(this.config.srcDir, `**/*{${defaultExtensions}}`));
    const testPattern = norm(path.join(this.config.testDir, `**/*{${defaultExtensions}}`));

    const srcFiles = glob.sync(srcPattern, { absolute: true, ignore: ['**/node_modules/**'] }).map(file => norm(file));
    const testFiles = glob.sync(testPattern, { absolute: true, ignore: ['**/node_modules/**'] }).map(file => norm(file));

    this.allFiles = [...srcFiles, ...testFiles].filter(f => this.matchesFilter(f)).map(file => norm(file));
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    filePath = norm(filePath);
    if (!this.allFiles.includes(filePath)) {
      this.allFiles.push(filePath);
      
      const fileType = this.isTestFile(filePath) ? 'test' : 
                      this.isSourceFile(filePath) ? 'source' : 'unknown';
      const output = norm(this.isTestFile(filePath) ? path.relative(this.config.testDir, filePath) : path.relative(this.config.srcDir, filePath)); 
      console.log(`➕ ${capitalize(fileType)} file added: ${output}`);
      
      await this.buildDependencyGraph([filePath]);
      this.queueRebuild(filePath, 'add');
    }
  }

  private handleFileRemove(filePath: string): void {
    filePath = norm(filePath);
    const affectedFiles = new Set<string>();
    const dependents = this.reverseDependencyGraph.get(filePath);
    dependents?.forEach(d => affectedFiles.add(d));

    this.allFiles = this.allFiles.filter(f => f !== filePath);
    this.dependencyGraph.delete(filePath);
    this.reverseDependencyGraph.delete(filePath);

    for (const deps of this.dependencyGraph.values()) deps.delete(filePath);
    for (const dep of this.reverseDependencyGraph.values()) dep.delete(filePath);

    const fileType = this.isTestFile(filePath) ? 'test' : 
                    this.isSourceFile(filePath) ? 'source' : 'unknown';
    let output = norm(this.isTestFile(filePath) ? path.relative(this.config.testDir, filePath) : path.relative(this.config.srcDir, filePath)); 
    console.log(`➖ ${capitalize(fileType)} file removed: ${output}`);

    // Determine update strategy
    const strategy = this.determineUpdateStrategy([filePath], 'unlink');

    output = norm(path.join(this.config.outDir, this.getOutputName(filePath)));

    if(fs.existsSync(output)) {
      fs.rmSync(output);
      fs.rmSync(output.replace(/\.js$/, '.js.map'));
    }

    this.emit('hmr:update', {
      type: strategy.type,
      path: this.getOutputName(filePath),
      timestamp: Date.now(),
      affectedTests: this.isSourceFile(filePath) ? Array.from(affectedFiles).filter(f => this.isTestFile(f)) : undefined,
      reason: strategy.reason
    });

    if (this.rebuildMode === 'selective' && affectedFiles.size > 0) {
      affectedFiles.forEach(f => this.queueRebuild(f, 'change'));
    }
  }

  private async handleDirectoryAdd(dirPath: string): Promise<void> {
    dirPath = norm(dirPath);
    const dirType = dirPath.startsWith(this.config.testDir) ? 'test': 'source';
    const output = norm(dirPath.startsWith(this.config.testDir) ? path.relative(this.config.testDir, dirPath) : path.relative(this.config.srcDir, dirPath));
    console.log(`📁 ${capitalize(dirType)} directory added: ${output}`);
    
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
      console.log(`📦 Found ${filesToProcess.length} ${dirType} files in new directory`);
      await this.buildDependencyGraph(filesToProcess);
      
      // Directory additions don't require full reload
      const strategy = this.determineUpdateStrategy(filesToProcess, 'addDir');
      
      this.emit('hmr:update', {
        type: strategy.type,
        path: output,
        timestamp: Date.now(),
        reason: strategy.reason
      });
      
      filesToProcess.forEach(f => this.queueRebuild(f, 'add'));
    }
  }

  private async handleDirectoryRemove(dirPath: string): Promise<void> {
    dirPath = norm(dirPath);
    const dirType = dirPath.startsWith(this.config.testDir) ? 'test': 'source';
    const output = norm(dirPath.startsWith(this.config.testDir) ? path.relative(this.config.testDir, dirPath) : path.relative(this.config.srcDir, dirPath));
    console.log(`📁 ${capitalize(dirType)} directory removed: ${output}`);
    
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

    // Determine strategy based on what was removed
    const strategy = this.determineUpdateStrategy(removedFiles, 'unlinkDir');

    this.emit('hmr:update', {
      type: strategy.type,
      path: output,
      timestamp: Date.now(),
      affectedTests: Array.from(affectedFiles).filter(f => this.isTestFile(f)),
      reason: strategy.reason
    });

    if (this.rebuildMode === 'selective' && affectedFiles.size > 0) {
      affectedFiles.forEach(f => this.queueRebuild(f, 'change'));
    }
  }

  private queueRebuild(filePath: string, changeType: 'add' | 'change' | 'unlink' = 'change') {
    const normalized = norm(filePath);
    this.directChanges.add(normalized);
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
        const directChangedFiles = Array.from(this.directChanges);
        this.directChanges.clear();

        const filesToRebuild = new Set<string>();

        for (const file of changedFiles) {
          const deps = this.getFilesToRebuild(file);
          deps.forEach(f => filesToRebuild.add(f));
        }

        const rebuiltFiles = Array.from(filesToRebuild);

        // Determine update strategy
        const strategy = this.determineUpdateStrategy(directChangedFiles, 'change');
        
        // Collect affected tests for source changes
        const affectedTests = directChangedFiles
          .filter(f => this.isSourceFile(f))
          .flatMap(f => this.getAffectedTests(f));

        const sourceChanges = directChangedFiles.filter(f => this.isSourceFile(f));
        const testChanges = directChangedFiles.filter(f => this.isTestFile(f));

        console.log(
          `📦 Changed: ${directChangedFiles.length} files ` +
          `(${sourceChanges.length} source, ${testChanges.length} test) → ` +
          `Rebuilding: ${rebuiltFiles.length} files (${strategy.type})`
        );

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
              type: strategy.type,
              path: relative,
              timestamp: Date.now(),
              content,
              affectedTests: affectedTests.length > 0 ? affectedTests : undefined,
              reason: strategy.reason
            });
          }
        }

        const duration = Date.now() - startTime;
        const updateType = sourceChanges.length > 0 ? 'source-change' :
                          testChanges.length > 0 ? 'test-only' : 'full';
        
        this.emit('hmr:rebuild', {
          changedFiles: directChangedFiles,
          rebuiltFiles,
          duration,
          timestamp: Date.now(),
          updateType
        } as RebuildStats);
        
        console.log(`✅ Rebuild complete (${updateType}): ${rebuiltFiles.length} files in ${duration}ms`);
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
    return norm(relative).replace(ext, '.js').replace(/[\/\\]/g, '_');
  }

  getDependencyInfo(filePath: string) {
    const normalized = norm(filePath);
    return {
      dependencies: Array.from(this.dependencyGraph.get(normalized) || []),
      dependents: Array.from(this.reverseDependencyGraph.get(normalized) || []),
      isTest: this.isTestFile(normalized),
      isSource: this.isSourceFile(normalized),
      isCritical: this.isCriticalSourceFile(normalized),
      affectedTests: this.isSourceFile(normalized) ? this.getAffectedTests(normalized) : []
    };
  }

  getStats() {
    const sourceFiles = this.allFiles.filter(f => this.isSourceFile(f));
    const testFiles = this.allFiles.filter(f => this.isTestFile(f));
    const criticalFiles = sourceFiles.filter(f => this.isCriticalSourceFile(f));

    return {
      totalFiles: this.allFiles.length,
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      criticalSourceFiles: criticalFiles.length,
      trackedDependencies: this.dependencyGraph.size,
      rebuildMode: this.rebuildMode,
      sourceChangeStrategy: this.sourceChangeStrategy,
      fileFilter: this.fileFilter,
      pathAliases: this.pathAliases,
      criticalPatterns: this.criticalSourcePatterns
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