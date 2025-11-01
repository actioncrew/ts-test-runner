// process-event-forwarder.ts
// Usage: import { ProcessEventForwarder } from './process-event-forwarder';
// const forwarder = new ProcessEventForwarder(); jasmine.getEnv().addReporter(forwarder);

type AnyObj = Record<string, any>;

function safeStringify(obj: any) {
  try { return JSON.stringify(obj); } catch (e) { return String(obj); }
}

// Lightweight serializer for Jasmine suite/spec/result objects to plain JSON
function serializeSpec(spec: any) {
  if (!spec) return null;
  return {
    id: typeof spec.id === 'string' ? spec.id : (spec.id ?? null),
    description: spec.description ?? (spec.getFullName ? spec.getFullName() : null),
    fullName: (typeof spec.getFullName === 'function') ? safeCall(() => spec.getFullName()) : (spec.fullName ?? null),
    status: spec.status ?? null,
    failedExpectations: Array.isArray(spec.failedExpectations) ? spec.failedExpectations.map(serializeFailedExpectation) : [],
    passedExpectations: Array.isArray(spec.passedExpectations) ? spec.passedExpectations.map(serializePassedExpectation) : [],
    duration: spec.duration ?? null,
    // additional metadata if present
    filePath: spec._filePath ?? spec.filePath ?? null,
  };
}

function serializeSuite(suite: any) {
  if (!suite) return null;
  return {
    id: suite.id ?? null,
    description: suite.description ?? null,
    fullName: (typeof suite.getFullName === 'function') ? safeCall(() => suite.getFullName()) : (suite.fullName ?? null),
    // children are not serialized by default here (could be large)
    filePath: suite._filePath ?? suite.filePath ?? null,
  };
}

function serializeFailedExpectation(fe: any) {
  if (!fe) return null;
  return {
    message: fe.message ?? null,
    stack: fe.stack ?? null,
    matcherName: fe.matcherName ?? null,
    passed: fe.passed ?? null,
  };
}

function serializePassedExpectation(pe: any) {
  if (!pe) return null;
  return {
    matcherName: pe.matcherName ?? null,
    message: pe.message ?? null,
  };
}

function safeCall<T>(fn: () => T, fallback: any = null): any {
  try { return fn(); } catch (e) { return fallback; }
}

export class ProcessEventForwarder {
  private connected = typeof process !== 'undefined' && !!(process as any).connected;
  private queue: AnyObj[] = [];
  // store ordered lists from jasmineStarted if provided
  private orderedSpecs: AnyObj[] = [];
  private orderedSuites: AnyObj[] = [];

  constructor() {
    // start listening for commands from host
    if (typeof process !== 'undefined' && (process as any).on) {
      (process as any).on('message', this.onParentMessage.bind(this));
    }

    // if IPC is not ready yet, wait for 'connect' event on process (child)
    // Node's child process has 'connected' boolean; but we still support queueing
    this.send({ type: 'ready', timestamp: Date.now() });
  }

  // central send (queues until IPC available)
  private send(msg: AnyObj) {
    const safeMsg = { ...msg, timestamp: Date.now() };
    if (typeof process === 'undefined' || typeof (process as any).send !== 'function') {
      // no process.send available — drop or log
      // console.warn('IPC not available, dropping message', safeMsg);
      this.queue.push(safeMsg);
      return;
    }

    try {
      if ((process as any).connected === false) {
        this.queue.push(safeMsg);
      } else {
        (process as any).send(safeMsg);
        // flush queue if any
        while (this.queue.length && (process as any).connected) {
          const q = this.queue.shift();
          try { (process as any).send(q); } catch (_) { /* keep rest queued */ break; }
        }
      }
    } catch (err) {
      // Queue on any error
      this.queue.push(safeMsg);
    }
  }

  // ---- Jasmine reporter methods ----
  // jasmineStarted: config is an object that Jasmine provides
  jasmineStarted(config: any) {
    // Try to collect ordered specs/suites if provided by env
    try {
      if (config && config.Order && Array.isArray(config.orderedSpecs)) {
        this.orderedSpecs = (config.orderedSpecs as any[]).map(s => serializeSpec(s)) as any;
      }
    } catch (e) { /* ignore */ }

    // but some runners pass config with order info; we'll forward config plus any available ordered lists
    this.send({
      type: 'jasmineStarted',
      config: config ?? null
    });
  }

  suiteStarted(suite: any) {
    this.send({
      type: 'suiteStarted',
      suite: serializeSuite(suite)
    });
  }

  specStarted(spec: any) {
    this.send({
      type: 'specStarted',
      spec: serializeSpec(spec)
    });
  }

  specDone(result: any) {
    // result is a Jasmine SpecResult
    this.send({
      type: 'specDone',
      result: serializeSpec(result) // includes failure / pass arrays
    });
  }

  suiteDone(suite: any) {
    this.send({
      type: 'suiteDone',
      suite: serializeSuite(suite)
    });
  }

  jasmineDone(result: any) {
    // include coverage if present
    const coverage = typeof globalThis !== 'undefined' ? (globalThis as any).__coverage__ : undefined;
    this.send({
      type: 'jasmineDone',
      result: result ?? null,
      coverage: coverage ? safeStringify(coverage) : null
    });
  }

  // Optional additional hooks that JMS might call - keep safe
  jasmineFailed? = (err: any) => {
    this.send({ type: 'jasmineFailed', error: String(err) });
  };

  // ---- Parent -> child commands handler ----
  private async onParentMessage(msg: any) {
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    try {
      switch (msg.type) {
        case 'ping':
          this.send({ type: 'pong' });
          break;

        case 'list':
          // request to list known specs/suites - we only can forward what we've seen via events
          this.send({
            type: 'list',
            orderedSpecs: this.orderedSpecs,
            orderedSuites: this.orderedSuites,
            // note: if you need a full traversal, the host should instruct the runner to collect it
          });
          break;

        case 'ordered':
          // ask to send ordered specs/suites if any
          this.send({
            type: 'ordered',
            orderedSpecs: this.orderedSpecs,
            orderedSuites: this.orderedSuites
          });
          break;

        case 'run':
          // host asks child to run certain specs — we ack; actual run logic depends on integration
          // If your runner exposes a global runner.runTests([...ids]) (like browser runner), you can attempt to call it here.
          // We'll perform a best-effort attempt and send back an ack / error.
          try {
            const specIds = Array.isArray(msg.specIds) ? msg.specIds : null;
            this.send({ type: 'run:ack', specIds });
            // Attempt to call a global runner if available
            if (typeof (globalThis as any).runner?.runTests === 'function' && specIds) {
              const results = await (globalThis as any).runner.runTests(specIds);
              this.send({ type: 'run:done', results });
            } else if (typeof (globalThis as any).runner?.runTest === 'function' && specIds && specIds.length === 1) {
              const results = await (globalThis as any).runner.runTest(specIds[0]);
              this.send({ type: 'run:done', results });
            } else {
              // Can't run here; host/parent should kick Jasmine execution itself or set up runner API
              this.send({ type: 'run:info', message: 'No local runner API found; acknowledged request.' });
            }
          } catch (err) {
            this.send({ type: 'run:error', error: String(err) });
          }
          break;

        case 'shutdown':
          this.send({ type: 'shutdown:ack' });
          // give parent a moment then exit
          setTimeout(() => {
            try { process.exit(0); } catch (e) { /* ignore */ }
          }, 50);
          break;

        // Expand with other control messages as needed
        default:
          this.send({ type: 'unknownCommand', received: msg });
      }
    } catch (err) {
      this.send({ type: 'onParentMessageError', error: String(err), original: msg });
    }
  }
}
