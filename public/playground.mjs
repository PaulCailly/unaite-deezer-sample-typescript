export function requestPayload(query,variablesText){
 if(typeof query!=='string'||!query.trim())throw new Error('Saisissez une requête GraphQL.');
 let variables;try{variables=JSON.parse(variablesText.trim()||'{}');}catch{throw new Error('Les variables doivent être un objet JSON valide.');}
 if(!variables||Array.isArray(variables)||typeof variables!=='object')throw new Error('Les variables doivent être un objet JSON.');
 const body={query,variables};if(new TextEncoder().encode(JSON.stringify(body)).length>60000)throw new Error('Requête trop volumineuse (60 Ko maximum).');return body;
}
export async function executeQuery(query,variablesText,csrf,send=fetch){
 const body=requestPayload(query,variablesText);
 const response=await send('/api/pipe',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 return {status:response.status,body:await response.json()};
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);
 const examples={
  profile:{query:'query Profile {\n  me { user { id } }\n}',variables:'{}'},
  search:{query:'query Search($q: String!) {\n  search(query: $q) {\n    results {\n      artists(first: 3) {\n        edges { node { id name } }\n      }\n    }\n  }\n}',variables:'{"q":"Daft Punk"}'},
  permissions:{query:'query Access {\n  permissions {\n    access { hasLimitedPermissions }\n  }\n}',variables:'{}'},
  schema:{query:'query Schema {\n  __schema {\n    queryType { name }\n    types { name kind description }\n  }\n}',variables:'{}'}
 };
 const clearResult=()=>{$('result').textContent='';$('request-status').textContent='';};
 function choose(){const selected=examples[$('example').value];$('query-editor').value=selected.query;$('variables-editor').value=selected.variables;clearResult();}
 async function session(){const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Session indisponible.');const s=await r.json();$('session-status').textContent=s.authenticated?'Connecté · scope all · jetons conservés côté serveur':'Connectez-vous depuis la sample app, puis revenez ici.';$('execute').disabled=!s.authenticated;return s;}
 $('example').addEventListener('change',choose);
 $('query-form').addEventListener('submit',async event=>{event.preventDefault();$('execute').disabled=true;clearResult();try{
  requestPayload($('query-editor').value,$('variables-editor').value);
  const s=await session();if(!s.authenticated)return;$('execute').disabled=true;$('request-status').textContent='Requête en cours…';const started=performance.now();
  const r=await executeQuery($('query-editor').value,$('variables-editor').value,s.csrf);
  $('result').textContent=JSON.stringify(r.body,null,2);$('request-status').textContent=`HTTP ${r.status} · ${Math.round(performance.now()-started)} ms`+(r.body.errors?.length?` · ${r.body.errors.length} erreur(s) GraphQL`:'');
  if(r.status===401)await session();
 }catch(error){$('request-status').textContent=error.name==='TimeoutError'?'Délai dépassé. Vérifiez la connexion puis réessayez.':error.message;}finally{try{await session();}catch{$('execute').disabled=true;}}});
 $('clear').addEventListener('click',clearResult);
 $('recheck').addEventListener('click',()=>session().catch(e=>{$('session-status').textContent=e.message;}));
 window.addEventListener('pagehide',clearResult);window.addEventListener('pageshow',()=>session().catch(e=>{$('session-status').textContent=e.message;}));
 choose();session().catch(e=>{$('session-status').textContent=e.message;});
}
