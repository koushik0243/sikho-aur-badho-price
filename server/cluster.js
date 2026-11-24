// Runs the API on several CPU cores: one primary process starts WEB_CONCURRENCY workers
// (default: number of cores, at most 4), each a full copy of app.js sharing the same port.
// A worker that crashes is replaced. Work that must happen once per server — resuming video
// conversions — runs in worker 0 only (see app.js).
//
//   npm start               → this file (production)
//   npm run start:single    → one process (node app.js)
//   npm run dev             → one process with nodemon (development)
//
// Each worker opens its own MongoDB pool (maxPoolSize in _helpers/db.js), so keep
// WEB_CONCURRENCY × maxPoolSize within what the database allows.
import cluster from 'node:cluster';
import os from 'node:os';

const MAX_DEFAULT_WORKERS = 4;
const RESTART_DELAY_MS = 1000;

if (cluster.isPrimary) {
    const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    const count = Math.max(1, Number(process.env.WEB_CONCURRENCY) || Math.min(cores, MAX_DEFAULT_WORKERS));
    const startWorker = (index) => {
        const worker = cluster.fork({ WORKER_INDEX: String(index) });
        worker.on('exit', (code, signal) => {
            if (signal === 'SIGTERM' || code === 0) return; // stopped on purpose
            console.error(`[cluster] worker ${index} exited (${signal || code}); restarting`);
            setTimeout(() => startWorker(index), RESTART_DELAY_MS);
        });
    };
    console.log(`[cluster] starting ${count} API worker(s)`);
    for (let i = 0; i < count; i++) startWorker(i);
} else {
    await import('./app.js');
}
