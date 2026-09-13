import { readJson, v, HttpError, json } from './http.js';

// One strongly-consistent board for all viewers. Serial storage transactions keep
// concurrent staff posts from replacing one another (unlike a KV read/modify/write).
export class StreamClaims {
  constructor(ctx){this.storage=ctx.storage;}
  async fetch(req){
    try {
      const path=new URL(req.url).pathname,internal=/^\/_checkout\/([^/]+)(?:\/(\w+))?$/.exec(path);
      if(req.method==='GET'){
        const claims=await this.storage.get('claims')||[];
        if(internal){const claim=claims.find(c=>c.id===internal[1]);if(!claim)throw new HttpError(404,'Claim not found');return json({claim});}
        return json({claims:claims.filter(c=>Date.parse(c.at)>Date.now()-30*86400000).map(({checkout,squareVariationId,tcgProductId,fulfillment,...c})=>({...c,paymentManaged:!!checkout,payable:!!squareVariationId}))});
      }
      const b=await readJson(req,8192);
      let result;
      await this.storage.transaction(async tx=>{
        const claims=(await tx.get('claims')||[]).filter(c=>(c.checkout&&c.status==='claimed')||Date.parse(c.at)>Date.now()-30*86400000);
        if(internal){
          result=claims.find(c=>c.id===internal[1]);if(!result)throw new HttpError(404,'Claim not found');
          const action=internal[2];
          if(action==='begin'){
            if(result.status!=='claimed')throw new HttpError(409,'This claim is not awaiting payment');
            if(!result.checkout){
              const reserved=claims.filter(c=>c.id!==result.id&&c.status==='claimed'&&c.checkout&&c.squareVariationId===result.squareVariationId).length;
              if(!Number.isInteger(b.available)||b.available<=reserved)throw new HttpError(409,'No unreserved Square stock remains for this variation');
              result.checkout={state:'creating',ref:'TL-CLAIM-'+result.id,shippingCents:b.shippingCents};
            }
          }else if(action==='link'){
            if(!result.checkout)throw new HttpError(409,'Checkout has not started');
            if(result.checkout.squareOrderId&&result.checkout.squareOrderId!==b.orderId)throw new HttpError(409,'Checkout order mismatch');
            Object.assign(result.checkout,{state:result.status==='paid'?'paid':'pending',url:b.url,paymentLinkId:b.id,squareOrderId:b.orderId});
          }else if(action==='paid'){
            if(!result.checkout)throw new HttpError(409,'Checkout has not started');
            if(result.checkout.squareOrderId&&result.checkout.squareOrderId!==b.orderId)throw new HttpError(409,'Checkout order mismatch');
            Object.assign(result.checkout,{state:'paid',squareOrderId:b.orderId,paymentId:b.paymentId});
            if(result.status!=='shipped')result.status='paid';
          }else if(action==='cancel'){
            if(result.status==='paid'||result.status==='shipped')throw new HttpError(409,'Paid claims need a refund in Square');
            result.status='cancelled';if(result.checkout)result.checkout.state='cancelled';
          }else throw new HttpError(404,'Unknown checkout action');
          result.updatedAt=new Date().toISOString();
        }else if(req.method==='POST'){
          if(claims.length>=100)throw new HttpError(409,'The claim board is full; resolve outstanding claims before adding more');
          if(typeof b.price!=='number')throw new HttpError(400,'price must be a number');
          result={id:crypto.randomUUID(),at:new Date().toISOString(),card:v.str(b.card,{min:1,max:120,name:'card'}),handle:v.str(b.handle,{min:1,max:40,name:'public handle'}),price:v.num(b.price,{min:0,max:100000,name:'price'}),status:'claimed'};
          if(/@[^\s]+\./.test(result.handle)||/\d[\d ()+-]{8,}\d/.test(result.handle))throw new HttpError(400,'Use a public handle, not an email or phone number');
          if(b.squareVariationId){
            if(typeof b.squareVariationId!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(b.squareVariationId))throw new HttpError(400,'Use the exact Square variation ID');
            result.squareVariationId=b.squareVariationId;
            result.fulfillment=v.oneOf(b.fulfillment||'ship',['ship','pickup'],{name:'fulfillment'});
            if(b.tcgProductId){if(!/^\d{1,12}$/.test(String(b.tcgProductId)))throw new HttpError(400,'TCGplayer product ID must be numeric');result.tcgProductId=String(b.tcgProductId);}
          }
          claims.unshift(result);
        }else if(req.method==='PUT'){
          const id=new URL(req.url).pathname.split('/').pop();
          result=claims.find(c=>c.id===id);if(!result)throw new HttpError(404,'Claim not found');
          if(result.checkout && !(result.status==='paid'&&b.status==='shipped') && b.status!==result.status)throw new HttpError(409,'Square confirms payment automatically. Cancel unpaid links using the checkout action; refund paid orders in Square.');
          result.status=v.oneOf(b.status,['claimed','paid','shipped','cancelled'],{name:'status'});
          result.updatedAt=new Date().toISOString();
        }else throw new HttpError(405,'Method not allowed');
        await tx.put('claims',claims);
      });
      return json({claim:result});
    }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);throw e;}
  }
}
