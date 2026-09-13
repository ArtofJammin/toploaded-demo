// Development/test adapter for the Durable Object storage subset used by claims.
export function memoryObject(ObjectClass){
  let committed=new Map(),tail=Promise.resolve();
  const adapter=map=>({get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v))});
  const storage={get:async k=>structuredClone(committed.get(k)),transaction(fn){
    const next=tail.then(async()=>{const work=structuredClone(committed),value=await fn(adapter(work));committed=work;return value;});
    tail=next.catch(()=>{});return next;
  }};
  const object=new ObjectClass({storage});
  return {idFromName:()=> 'local',get:()=>object};
}
