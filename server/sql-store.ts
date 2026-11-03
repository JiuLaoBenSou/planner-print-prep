import {createHash} from 'node:crypto';
import type {Mode} from './billing-core';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export type SqlValue=string|number|bigint|null|Uint8Array;
export type SqlRow=Record<string,any>;
export interface SyncDatabase{
 exec(sql:string):void;
 prepare(sql:string):{run(...values:SqlValue[]):{changes:number|bigint};get(...values:SqlValue[]):SqlRow|undefined;all(...values:SqlValue[]):SqlRow[]};
 close():void;
}
export class SqlBillingStore{
 constructor(readonly db:SyncDatabase,readonly mode:Mode,private readonly transaction:(work:()=>void)=>void){
  this.db.exec(`CREATE TABLE IF NOT EXISTS orders(mode TEXT,id TEXT,state TEXT NOT NULL,PRIMARY KEY(mode,id));
   CREATE TABLE IF NOT EXISTS licenses(mode TEXT,hash TEXT,order_id TEXT NOT NULL,PRIMARY KEY(mode,hash));
   CREATE TABLE IF NOT EXISTS events(mode TEXT,id TEXT,PRIMARY KEY(mode,id));
   CREATE TABLE IF NOT EXISTS checkouts(mode TEXT,id TEXT,response TEXT,PRIMARY KEY(mode,id));`);
 }
 apply(id:string,orderId:string,revoked:boolean,keys:string[]=[]){
  this.transaction(()=>{
   if(this.db.prepare('SELECT 1 FROM events WHERE mode=? AND id=?').get(this.mode,id)){return;}
   this.db.prepare(`INSERT INTO orders VALUES (?,?,?) ON CONFLICT(mode,id) DO UPDATE SET state=CASE WHEN orders.state='revoked' OR excluded.state='revoked' THEN 'revoked' ELSE 'paid' END`).run(this.mode,orderId,revoked?'revoked':'paid');
   for(const key of keys){const existing=this.db.prepare('SELECT order_id FROM licenses WHERE mode=? AND hash=?').get(this.mode,hash(key));if(existing&&existing.order_id!==orderId)throw Error('License belongs to another order.');this.db.prepare('INSERT OR IGNORE INTO licenses VALUES (?,?,?)').run(this.mode,hash(key),orderId);}
   this.db.prepare('INSERT INTO events VALUES (?,?)').run(this.mode,id);
  });
 }
 isPaid(key:string){return !!this.db.prepare("SELECT 1 FROM licenses l JOIN orders o ON o.mode=l.mode AND o.id=l.order_id WHERE l.mode=? AND l.hash=? AND o.state='paid'").get(this.mode,hash(key));}
 orderCount(){return Number(this.db.prepare('SELECT count(*) AS n FROM orders WHERE mode=?').get(this.mode)!.n);}
 checkout(id:string){return this.db.prepare('SELECT response FROM checkouts WHERE mode=? AND id=?').get(this.mode,id);}
 claimCheckout(id:string){return this.db.prepare('INSERT OR IGNORE INTO checkouts VALUES (?,?,NULL)').run(this.mode,id).changes===1;}
 finishCheckout(id:string,response:string){this.db.prepare('UPDATE checkouts SET response=? WHERE mode=? AND id=?').run(response,this.mode,id);}
 close(){this.db.close();}
}
