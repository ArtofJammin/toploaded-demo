import { readJson, v, HttpError, json } from './http.js';

// One strongly-consistent board for all viewers. Serial storage transactions keep
// concurrent staff posts from replacing one another (unlike a KV read/modify/write).
export class StreamClaims {
  constructor(ctx){this.storage=ctx.storage;}
  async fetch(req){
    try {
      if(req.method==='GET')return json({claims:(await this.storage.get('claims')||[]).filter(c=>Date.parse(c.at)>Date.now()-30*86400000)});
      const b=await readJson(req,8192);
      let result;
      await this.storage.transaction(async tx=>{
        const claims=(await tx.get('claims')||[]).filter(c=>Date.parse(c.at)>Date.now()-30*86400000);
        if(req.method==='POST'){
          if(typeof b.price!=='number')throw new HttpError(400,'price must be a number');
          result={id:crypto.randomUUID(),at:new Date().toISOString(),card:v.str(b.card,{min:1,max:120,name:'card'}),handle:v.str(b.handle,{min:1,max:40,name:'public handle'}),price:v.num(b.price,{min:0,max:100000,name:'price'}),status:'claimed'};
          if(/@[^\s]+\./.test(result.handle)||/\d[\d ()+-]{8,}\d/.test(result.handle))throw new HttpError(400,'Use a public handle, not an email or phone number');
          claims.unshift(result);
        }else if(req.method==='PUT'){
          const id=new URL(req.url).pathname.split('/').pop();
          result=claims.find(c=>c.id===id);if(!result)throw new HttpError(404,'Claim not found');
          result.status=v.oneOf(b.status,['claimed','paid','shipped','cancelled'],{name:'status'});
          result.updatedAt=new Date().toISOString();
        }else throw new HttpError(405,'Method not allowed');
        await tx.put('claims',claims.slice(0,100));
      });
      return json({claim:result});
    }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);throw e;}
  }
}
