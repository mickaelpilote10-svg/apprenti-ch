import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const b64 = (bytes: Uint8Array) => { let s=""; for (let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s); };
const enc = (s:string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const cleanHeader = (s:string) => s.replace(/[\r\n]/g," ").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({error:"Méthode non autorisée"}),{status:405,headers:cors});
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=req.headers.get("Authorization")||"";
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await caller.auth.getUser();
  if(authError||!user) return new Response(JSON.stringify({error:"Connecte-toi avant l’envoi."}),{status:401,headers:cors});
  const ownerId=Deno.env.get("APP_OWNER_USER_ID");
  if(!ownerId||user.id!==ownerId) return new Response(JSON.stringify({error:"L’envoi n’est pas autorisé pour ce compte."}),{status:403,headers:cors});
  const admin=createClient(url,service);
  try {
    const body=await req.json();
    if(typeof body.offerId!=="string"||typeof body.subject!=="string"||typeof body.message!=="string"||body.subject.length>180||body.message.length>10000)
      return new Response(JSON.stringify({error:"Contenu invalide."}),{status:400,headers:cors});
    const {data:offer,error:offerErr}=await admin.from("job_offers").select("*").eq("id",body.offerId).eq("is_active",true).maybeSingle();
    if(offerErr||!offer) return new Response(JSON.stringify({error:"Cette offre n’est plus disponible."}),{status:404,headers:cors});
    if(!offer.source_email_verified||!offer.source_email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offer.source_email)) return new Response(JSON.stringify({error:"Aucune adresse e-mail officielle et vérifiée n’est disponible pour cette offre."}),{status:400,headers:cors});
    const docIds=[body.cvDocumentId,body.letterDocumentId].filter((x)=>typeof x==="string");
    if(docIds.length!==2||new Set(docIds).size!==2) return new Response(JSON.stringify({error:"Ajoute ton CV et ta lettre dans Mes documents avant l’envoi."}),{status:400,headers:cors});
    const {data:docs,error:docErr}=await admin.from("documents").select("id,user_id,kind,title,storage_path,mime_type,size_bytes").in("id",docIds).eq("user_id",user.id);
    if(docErr||docs?.length!==2||!docs.some(d=>d.kind==="cv")||!docs.some(d=>d.kind==="letter")) return new Response(JSON.stringify({error:"Les pièces jointes doivent être ton CV et ta lettre enregistrés dans ton compte."}),{status:400,headers:cors});
    const attachments=[];
    for(const doc of docs){
      if(doc.size_bytes>10*1024*1024) return new Response(JSON.stringify({error:"Une pièce jointe dépasse 10 Mo."}),{status:400,headers:cors});
      const {data:file,error:fileErr}=await admin.storage.from("private-documents").download(doc.storage_path);
      if(fileErr||!file) throw new Error("Lecture d’une pièce jointe impossible.");
      attachments.push({name:doc.kind==="cv"?"CV_Mickael_Rouiller.pdf":`Lettre_Motivation_Mickael_Rouiller${doc.title.toLowerCase().endsWith('.docx')?'.docx':'.pdf'}`,type:doc.mime_type||"application/octet-stream",data:b64(new Uint8Array(await file.arrayBuffer()))});
    }
    const clientId=Deno.env.get("GOOGLE_CLIENT_ID"),clientSecret=Deno.env.get("GOOGLE_CLIENT_SECRET"),refresh=Deno.env.get("GOOGLE_REFRESH_TOKEN");
    if(!clientId||!clientSecret||!refresh) return new Response(JSON.stringify({error:"Gmail n’est pas encore configuré côté serveur."}),{status:503,headers:cors});
    const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"})});
    const tokenData=await tokenRes.json(); if(!tokenRes.ok||!tokenData.access_token) throw new Error("Gmail n’a pas pu autoriser l’envoi.");
    const boundary=`apprenti_${crypto.randomUUID()}`;
    const lines=[`To: ${cleanHeader(offer.source_email)}`,`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(cleanHeader(body.subject))))}?=`,`MIME-Version: 1.0`,`Content-Type: multipart/mixed; boundary="${boundary}"`,"","--"+boundary,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",b64(new TextEncoder().encode(body.message))];
    for(const file of attachments) lines.push("--"+boundary,`Content-Type: ${file.type}; name="${file.name}"`,`Content-Disposition: attachment; filename="${file.name}"`,"Content-Transfer-Encoding: base64","",file.data);
    lines.push("--"+boundary+"--");
    const gmail=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${tokenData.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({raw:enc(lines.join("\r\n"))})});
    const sent=await gmail.json(); if(!gmail.ok) throw new Error("Gmail a refusé l’envoi. Vérifie la configuration OAuth et le consentement Gmail.");
    await admin.from("applications").insert({user_id:user.id,company:offer.company,trade:offer.trade,email:offer.source_email,status:"Envoyée",sent_at:new Date().toISOString(),message:body.message,cv_document_id:docs.find(d=>d.kind==="cv")!.id,letter_document_id:docs.find(d=>d.kind==="letter")!.id,source_url:offer.source_url,notes:`Message Gmail envoyé (id ${sent.id||"confirmé"}).`});
    return new Response(JSON.stringify({ok:true,messageId:sent.id}),{headers:cors});
  } catch(e) { return new Response(JSON.stringify({error:e.message||"Erreur lors de l’envoi."}),{status:500,headers:cors}); }
});
