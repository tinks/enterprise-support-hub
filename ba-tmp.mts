import { createClient } from "@supabase/supabase-js";
import { computeSla, detectOrigin, evaluateCompliance, parseSeverity } from "/dev-server/src/lib/slaMetrics.ts";
import { classifySlaBatchRow } from "/dev-server/src/hooks/useSlaBatch.ts";
const url = process.env.VITE_SUPABASE_URL!, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const sb = createClient(url, key);
const t = await sb.from("teammates").select("intercom_admin_id,email,role").eq("role","support");
console.log("roster err", t.error?.message, t.data?.length);
const emails = new Set<string>(), ids = new Set<string>();
for (const r of t.data ?? []) { if (r.email) emails.add(r.email.toLowerCase()); if (r.intercom_admin_id) ids.add(String(r.intercom_admin_id)); }
const rows:any[] = []; let off=0;
while(true){ const {data,error}=await sb.from("intercom_tickets_v3").select("intercom_conversation_id,raw_payload,tags,rsa_override,customer_resolution_method,customer_key").in("lifecycle_status",["finalized","reopened_after_finalize"]).range(off,off+499); if(error){console.log("err",error.message);break;} rows.push(...data); if(data.length<500)break; off+=500; }
const ta = await sb.from("v3_customer_accounts").select("account_key,is_test");
const testKeys = new Set((ta.data??[]).filter(r=>r.is_test).map(r=>r.account_key));
type Agg = {met:number;breach:number;na:number};
const mk=():Agg=>({met:0,breach:0,na:0});
const old:Record<string,Agg>={}, nw:Record<string,Agg>={};
let flip=null;
for(const r of rows){
  const slaOld=computeSla(r.raw_payload);
  const slaNew=computeSla(r.raw_payload,{supportEmails:emails,supportAdminIds:ids});
  if(classifySlaBatchRow(r as any,slaNew,{testAccountKeys:testKeys})!=="inScope") continue;
  const sev=parseSeverity(r.raw_payload); if(!sev) continue;
  const o=detectOrigin(r.raw_payload);
  const src = o.samFirst ? "Sam-first" : o.isSlack ? "Slack" : "Direct";
  for(const [store,sla] of [[old,slaOld],[nw,slaNew]] as const){
    store[src]??=mk(); store["ALL"]??=mk();
    const v=evaluateCompliance(sla as any,sev).firstResponse.met;
    const k = v===null?"na":v?"met":"breach";
    store[src][k]++; store["ALL"][k]++;
  }
  if(r.intercom_conversation_id==="215474914796273") flip={old:evaluateCompliance(slaOld,sev).firstResponse,new:evaluateCompliance(slaNew,sev).firstResponse,sev};
}
const fmt=(a:Agg)=>`%met ${a.met+a.breach?((100*a.met/(a.met+a.breach)).toFixed(1)):"—"}%  met ${a.met} breach ${a.breach} n/a ${a.na}`;
for(const k of Object.keys(nw)) console.log(k.padEnd(10),"| OLD",fmt(old[k]),"| NEW",fmt(nw[k]));
console.log("215474914796273:",JSON.stringify(flip));
