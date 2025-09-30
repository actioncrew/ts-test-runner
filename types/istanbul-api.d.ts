// types/istanbul-api.d.ts
declare module 'istanbul-api' {
  import { CoverageMap } from 'istanbul-lib-coverage';

  export interface Reporter {
    dir: string;
    addAll(reports: string[]): void;
    write(coverageMap: CoverageMap, includeAllSources?: boolean): void;
  }

  export function createReporter(): Reporter;
}
