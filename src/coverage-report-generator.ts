import path from 'path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import libSourceMaps from 'istanbul-lib-source-maps';
import libIstanbulApi from 'istanbul-api';

export class CoverageReportGenerator {
  private reportDir: string;

  constructor(reportDir: string = path.join(process.cwd(), 'coverage')) {
    this.reportDir = reportDir;
  }

  async generate(rawCoverageData: Record<string, any>): Promise<void> {
    if (!rawCoverageData || Object.keys(rawCoverageData).length === 0) {
      console.warn('⚠️  No coverage data received.');
      return;
    }

    // 1️⃣ Coverage map from raw data
    const coverageMap = libCoverage.createCoverageMap(rawCoverageData);

    // 2️⃣ Remap coverage using source maps (assumes map files are alongside JS files)
    const remapper = libSourceMaps.createSourceMapStore();
    const remappedCoverage = await remapper.transformCoverage(coverageMap);

    // 3️⃣ Create report context
    const context = libReport.createContext({
      dir: this.reportDir,
      coverageMap: remappedCoverage
    });

    // 4️⃣ Generate reports
    const reporter = libIstanbulApi.createReporter();
    reporter.dir = this.reportDir;
    reporter.addAll(['html', 'lcov', 'text']);
    reporter.write(remappedCoverage, true);

    console.log(`✅ Coverage reports generated successfully in ${this.reportDir}`);
  }
}
