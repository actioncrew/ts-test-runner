# TypeScript Test Runner

Run your Jasmine TypeScript tests in multiple environments: browsers, headless browsers, or Node.js.

## What This Tool Does

- Compiles your TypeScript test files
- Runs Jasmine tests in your chosen environment:
  - **Real browsers** (Chrome, Firefox, Safari) - for DOM and browser API testing
  - **Headless browsers** - same browser environments without UI (perfect for CI/CD)
  - **Node.js** - fastest execution for pure logic testing
- Supports **code coverage** via Istanbul instrumentation
- Supports **Hot Module Reload (HMR)** for instant test feedback

## Installation

```bash
# Core dependencies
npm install --save-dev @actioncrew/ts-test-runner

# For browser testing (optional but recommended)
npx playwright install
```

## Quick Start

### 1. Initialize Your Project
```bash
npx ts-test-runner init
```
This creates `ts-test-runner.json` with default settings based on your project.

### 2. Write Jasmine Tests
Create `.spec.ts` files in your test directory:

```typescript
// tests/calculator.spec.ts
import { Calculator } from '../lib/calculator';

describe('Calculator', () => {
  let calc: Calculator;

  beforeEach(() => {
    calc = new Calculator();
  });

  it('should add two numbers', () => {
    expect(calc.add(2, 3)).toBe(5);
  });

  it('should handle browser APIs', () => {
    // This test will work in browser environments
    if (typeof window !== 'undefined') {
      expect(window.location).toBeDefined();
    }
  });
});
```

### 3. Run Your Tests

```bash
# Development: Open tests in browser with visual reporter
npx ts-test-runner

# CI/CD: Run headless in Chrome
npx ts-test-runner --headless

# Fastest: Run directly in Node.js (no browser overhead)
npx ts-test-runner --headless --browser node

# With coverage enabled (Istanbul instrumentation)
npx ts-test-runner --coverage
```

## Execution Environments

### Browser Mode (Default)
**Best for:** Development and debugging
```bash
npx ts-test-runner
```
- Opens `http://localhost:8888` in your default browser
- Interactive HTML test reporter
- Full browser DevTools for debugging
- Access to DOM, localStorage, fetch, etc.

### Headless Browser Mode
**Best for:** CI/CD and automated testing
```bash
# Chrome (default)
npx ts-test-runner --headless

# Test in Firefox
npx ts-test-runner --headless --browser firefox

# Test in Safari/WebKit
npx ts-test-runner --headless --browser webkit
```
- Runs in real browser without UI
- Full browser API support
- Console output with test results
- Great for cross-browser testing

### Node.js Mode
**Best for:** Fast unit testing
```bash
npx ts-test-runner --headless --browser node
```
- Fastest execution (no browser startup)
- Limited to Node.js APIs only
- Perfect for testing pure TypeScript logic
- No DOM or browser-specific APIs

### Coverage Mode

When `--coverage` is enabled:
- Source files are instrumented using **istanbul-lib-instrument** during preprocessing.
- Coverage data is collected while tests run.
- Reports are generated using **istanbul-lib-report** and **istanbul-reports**.
- Supported output formats: `html`, `lcov`, `text`.

Coverage reports are generated in the `coverage/` folder by default:

```bash
npx ts-test-runner --coverage
# → ./coverage/index.html
```

### Watch Mode

When `--watch` is enabled:

The runner watches your **source** and **test files** for changes. Modified files are recompiled and hot-reloaded into the running environment — no full reload required.

Jasmine’s suite tree is automatically updated:
- Removed specs are detached from the active suite.
- Updated specs are re-imported and re-registered.
- Only the affected tests are re-executed, preserving test context and speed.

The system uses WebSocket-based updates to synchronize browser and Node test environments in real time. This allows you to iterate rapidly with instant feedback on every code change.

```bash
npx ts-test-runner --watch
```

## Project Structure

The test runner expects this structure (customizable in config):

```
your-project/
├── src/lib/                   # Your TypeScript source code
├── src/tests/                 # Your .spec.ts test files
├── dist/.vite-jasmine-build/  # Compiled output (auto-generated)
├── ts-test-runner.json        # Configuration file
└── tsconfig.json              # TypeScript configuration
```

## Configuration File

After running `init`, you'll have a `ts-test-runner.json`:

```json
{
  "srcDir": "./src/lib",           // Your source code location  
  "testDir": "./src/tests",        // Your test files location
  "outDir": "./dist/.vite-jasmine-build",  // Build output
  "tsconfig": "tsconfig.json",     // TypeScript config
  "port": 8888,                    // Development server port
  "browser": "chrome",             // Default browser for headless
  "headless": false,               // Default to browser mode
  "htmlOptions": {
    "title": "My Project Tests"    // Browser page title
  }
}
```

## Writing Tests

Your standard Jasmine `.spec.ts` files:

## Environment-Specific Testing

### Browser-Only Features
```typescript
describe('Browser APIs', () => {
  beforeEach(() => {
    // Skip if not in browser
    if (typeof window === 'undefined') {
      pending('Browser-only test');
    }
  });

  it('should test localStorage', () => {
    localStorage.setItem('test', 'value');
    expect(localStorage.getItem('test')).toBe('value');
    localStorage.removeItem('test');
  });

  it('should test DOM manipulation', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello World';
    document.body.appendChild(div);
    
    expect(document.querySelector('div')?.textContent).toBe('Hello World');
    
    document.body.removeChild(div);
  });
});
```

### Node.js-Only Features
```typescript
describe('Node.js APIs', () => {
  beforeEach(() => {
    // Skip if in browser
    if (typeof process === 'undefined') {
      pending('Node.js-only test');
    }
  });

  it('should access process information', () => {
    expect(process.version).toMatch(/^v\d+/);
  });
});
```

### Cross-Environment Tests
```typescript
describe('Universal Code', () => {
  it('should work in any environment', () => {
    const result = myPureFunction('input');
    expect(result).toBe('processed input');
  });

  it('should detect environment correctly', () => {
    const isBrowser = typeof window !== 'undefined';
    const isNode = typeof process !== 'undefined';
    
    expect(isBrowser || isNode).toBe(true);
  });
});
```

## Command Reference

| Command | Description |
|---------|-------------|
| `npx ts-test-runner` | Run in browser (development mode) |
| `npx ts-test-runner --headless` | Run in headless Chrome |
| `npx ts-test-runner --headless --browser firefox` | Run in headless Firefox |
| `npx ts-test-runner --headless --browser webkit` | Run in headless Safari |
| `npx ts-test-runner --headless --browser node` | Run in Node.js (fastest) |
| `npx ts-test-runner init` | Create configuration file |
| `npx ts-test-runner --config custom.json` | Use custom config file |

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npm ci
      - run: npx playwright install --with-deps
      
      # Fast Node.js tests
      - run: npx ts-test-runner --headless --browser node
      
      # Browser compatibility tests
      - run: npx ts-test-runner --headless --browser chrome
      - run: npx ts-test-runner --headless --browser firefox
```

### Performance Comparison

| Environment | Speed | Browser APIs | Use Case |
|-------------|-------|-------------|----------|
| Node.js | ⚡ Fastest | ❌ None | Unit tests, pure logic |
| Headless Chrome | 🐌 Medium | ✅ Full | Integration tests, DOM |
| Headless Firefox | 🐌 Medium | ✅ Full | Cross-browser testing |
| Browser (headed) | 🐌 Slowest | ✅ Full + DevTools | Development, debugging |

## Troubleshooting

### "Browser not found" Error
```bash
# Install Playwright browsers
npx playwright install

# Or install specific browser
npx playwright install chrome
```

### Port Already in Use
Change the port in `ts-test-runner.json`:
```json
{
  "port": 3000
}
```

### Tests Not Found
Verify:
- Test files are in the `testDir` location
- Files have `.spec.ts` extension  
- Tests use proper Jasmine syntax

### TypeScript Compilation Errors
Check your `tsconfig.json` configuration matches your project structure.

## Why Use This Tool?

- **vs Jest:** Better browser testing support, real browser environments
- **vs Mocha:** Includes Jasmine framework, less configuration needed  
- **vs Vitest:** Focuses on browser compatibility, established Jasmine ecosystem
- **vs Karma:** Modern tooling, TypeScript-first, simpler setup

## License

MIT © 2025