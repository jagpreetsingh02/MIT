import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Scan, ScanInput } from '../shared/types.js';
export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DB_PATH || 'data/rippleguard.sqlite') {
    if(path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, json TEXT NOT NULL, input TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(1);`);
  }
  save(scan: Scan, input?: ScanInput) { this.db.prepare('INSERT INTO scans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(scan.id, JSON.stringify(scan), JSON.stringify(input || {})); }
  get(id: string): Scan | undefined { const row = this.db.prepare('SELECT json FROM scans WHERE id=?').get(id); return row ? JSON.parse(row.json as string) : undefined; }
  input(id: string): ScanInput { return JSON.parse(this.db.prepare('SELECT input FROM scans WHERE id=?').get(id)!.input as string); }
  list(): Scan[] {return this.db.prepare('SELECT json FROM scans ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.json as string));}
  pending(): Scan[] {return this.db.prepare("SELECT json FROM scans WHERE json_extract(json,'$.status') IN ('queued','scanning','enriching')").all().map(r => JSON.parse(r.json as string));}
  cacheGet(key:string): string | undefined { return this.db.prepare('SELECT value FROM cache WHERE key=? AND expires>?').get(key, Date.now())?.value as string | undefined; }
  cachePut(key:string,value:string,ttl:number) { this.db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(key,value,Date.now()+ttl); }
  dedupe(id:string): boolean { this.db.prepare('DELETE FROM deliveries WHERE created<?').run(Date.now()-7*86400000); return this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES(?,?)').run(id,Date.now()).changes === 1; }
  close() {this.db.close();}
}
