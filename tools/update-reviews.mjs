#!/usr/bin/env node
// Public feedback only. No cookies, credentials, order IDs or account IDs are saved.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const SELLER='5c356cdf';
export const SOURCE='https://www.tcgplayer.com/sellers/Top-Loaded-TCG/5c356cdf/feedback';
export const ENDPOINT='https://seller-stores-backend.tcgplayer.com/sf/sellerorderfeedback/?sellerKey='+SELLER+'&sortBy=createdDate&rows=20&rating=5&requireComment=true&days=365';
export function highlights(data,now=new Date()){
  if(!data||!Array.isArray(data.result))throw new Error('Unrecognized public feedback response; keeping last-good file');
  const items=[],seen=new Set();let words=0;
  for(const row of data.result){
    if(!row||row.sellerKey!==SELLER||row.active!==true||row.feedbackRating!==5||typeof row.comment!=='string')continue;
    const quote=row.comment.trim(),count=quote.split(/\s+/).length,date=new Date(row.createdDate);
    // Publish up to three complete, short comments, with a 25-word total ceiling.
    // No excerpts that could change the meaning of a longer review.
    if(!quote||quote==='No Comment Provided.'||count>12||words+count>25||seen.has(quote)||!Number.isFinite(date.getTime())||date>now||now-date>366*86400000)continue;
    const name=String(row.userNickname||'').trim();
    const who=/^[^*]\*+[^*]$/.test(name)?name[0]+'****'+name.at(-1):'TCGplayer buyer';
    items.push({quote,who,rating:5,source:'tcgplayer',url:SOURCE,at:date.toISOString()});words+=count;seen.add(quote);
    if(items.length===3)break;
  }
  return {sellerKey:SELLER,generated:now.toISOString(),source:SOURCE,selection:'Recent five-star feedback with short written comments; selected highlights, not an overall rating.',items};
}
export async function refreshReviews({force=false,fetcher=fetch,file=resolve(fileURLToPath(new URL('../reviews-tcgplayer.json',import.meta.url)))}={}){
  if(!force&&existsSync(file)){
    const old=JSON.parse(readFileSync(file,'utf8')),age=Date.now()-Date.parse(old.generated);
    if(age>=0&&age<20*3600000)return {skipped:true,count:old.items?.length||0};
  }
  const response=await fetcher(ENDPOINT,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('TCGplayer feedback returned HTTP '+response.status+'; keeping last-good file');
  const output=highlights(await response.json());
  const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(output,null,2)+'\n');renameSync(temp,file);
  return {skipped:false,count:output.items.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  refreshReviews({force:process.argv.includes('--force')}).then(r=>console.log((r.skipped?'Already refreshed':'Published')+': '+r.count+' attributed feedback highlights')).catch(e=>{console.error(e.message);process.exitCode=1;});
}
