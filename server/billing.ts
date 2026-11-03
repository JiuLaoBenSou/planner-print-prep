import {DatabaseSync} from 'node:sqlite';
import {SqlBillingStore,type SyncDatabase} from './sql-store';
import type {Mode} from './billing-core';
export {createBilling,verifySignature} from './billing-core';
export type {BillingConfig,Mode} from './billing-core';
export class BillingStore extends SqlBillingStore{
 constructor(path:string|SyncDatabase,mode:Mode,transaction?:(work:()=>void)=>void){
  const db=typeof path==='string'?new DatabaseSync(path):path;
  if(typeof path==='string')db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  super(db,mode,transaction??((work)=>{db.exec('BEGIN IMMEDIATE');try{work();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}));
 }
}
