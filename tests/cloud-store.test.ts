import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {BillingStore} from '../server/billing';
it('uses an injected SQLite connection and rolls back an entire event when a license belongs to another order',()=>{
 const db=new DatabaseSync(':memory:');let transactions=0;
 const transact=(work:()=>void)=>{transactions++;db.exec('BEGIN IMMEDIATE');try{work();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}};
 // A cloud SQLite connection supplies its own synchronous transaction primitive.
 const store=new BillingStore(db,'test',transact);
 store.apply('first','order-1',false,['license-1']);
 expect(()=>store.apply('conflict','order-2',false,['license-2','license-1'])).toThrow('License belongs to another order.');
 expect(store.orderCount()).toBe(1);expect(store.isPaid('license-2')).toBe(false);
 expect(db.prepare('SELECT 1 FROM events WHERE id=?').get('conflict')).toBeUndefined();
 store.apply('refund','order-1',true);store.apply('late','order-1',false,['license-1']);
 expect(store.isPaid('license-1')).toBe(false);expect(transactions).toBe(4);store.close();
});
