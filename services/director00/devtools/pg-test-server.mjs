// Real Postgres 17 + pgvector compiled to WebAssembly (PGlite), served on the Postgres wire protocol.
// Lets the Director 00 tests hit actual pgvector SQL (HNSW index, <=> operator) on a laptop without Docker.
//   node pg-test-server.mjs [port]      then  DIRECTOR_TEST_PG_URL=postgresql://postgres:x@127.0.0.1:5499/postgres
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.argv[2] ?? 5499);
const db = await PGlite.create({ extensions: { vector } });   // in-memory: every run starts clean
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", debug: !!process.env.PGLITE_DEBUG });
await server.start();
console.log(`pglite+pgvector listening on 127.0.0.1:${port}`);
const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
