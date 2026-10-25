// Generated application client: upstream credentials never leave the platform server.
export const sharedClientSource = String.raw`// Pixloom Cloud client. Persistent auth is mediated by the trusted platform host.
let configPromise,session=null,restoring=null,epoch=0,channel,localLogout=false;
const base=import.meta.env.BASE_URL;
const bridgeNonce=new URL(location.href).searchParams.get('__pixloom_auth');
async function config(){
 if(!configPromise)configPromise=fetch(base+'pixloom-cloud.json',{cache:'no-store',credentials:'omit'}).then(async response=>{
  if(!response.ok)throw new Error('Cloud 配置未就绪');const value=await response.json();
  const url=new URL(value.endpoint);if(value.format!=='pixloom-cloud-v2'||url.pathname!=='/cloud/v2/apps/'+value.projectId+'/environments/'+value.environment+'/'+value.generation||url.search||url.hash||url.username||url.password)throw new Error('Cloud 配置无效');return value;
 });return configPromise;
}
const failure=(message,status)=>Object.assign(new Error(message),{status});
function parentAuth(action,payload){
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(new Error('登录服务连接超时，请重新打开应用预览'))},25000);
  channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve(event.data.result):reject(new Error(event.data?.message||'登录服务暂不可用'))};
  const origin=new URL(base,location.href).origin;
  window.parent.postMessage({type:'pixloom-cloud-auth-v1',action,payload,nonce:bridgeNonce},origin,[channel.port2]);
 });
}
async function nativeAuth(action,payload,value){
 const scope=[value.endpoint,value.environmentId,value.generation].join('|'),marker='pixloom:pending-logout:'+scope;
 if(!channel){try{channel=new BroadcastChannel('pixloom-cloud-auth');channel.onmessage=event=>{if(event.data?.scope===scope&&['signedout','changed'].includes(event.data.type)){session=null;epoch++;location.reload()}}}catch{}}
 const send=async(action,payload={})=>{
  const response=await fetch('/__pixloom/auth/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  let result;try{result=await response.json()}catch{throw new Error('请从 Pixloom 预览入口或已发布的应用打开页面')}
  if(!response.ok)throw failure(result.message||'登录服务暂不可用',response.status);return result;
 };
 let marked=localLogout;try{marked=marked||localStorage.getItem(marker)==='1'}catch{}
 if(action==='signout'){localLogout=true;marked=true;try{localStorage.setItem(marker,'1')}catch{};channel?.postMessage({scope,type:'signedout'})}
 if(marked){await send('signout');localLogout=false;try{localStorage.removeItem(marker)}catch{};if(action==='signout')return {ok:true}}
 const result=await send(action,payload);if(action==='signin')channel?.postMessage({scope,type:'changed'});return result;
}
async function broker(action,payload={}){
 const value=await config();
 if(window.parent!==window)return parentAuth(action,payload);
 if(window.origin==='null')throw new Error('请从 Pixloom 的应用预览入口打开页面，以恢复登录');
 return nativeAuth(action,payload,value);
}
async function restore(){
 const value=await config();if(value.authMode!=='persistent-v1')return session;
 if(session&&session.expires_at*1000>Date.now()+5000)return session;
 if(!restoring){const version=epoch;restoring=broker('resume').then(result=>{if(version===epoch)session=result;return session}).finally(()=>{restoring=null})}
 return restoring;
}
async function request(path,options={}){
 const value=await config();if(!path.startsWith('auth/signup'))await restore();
 if(session&&session.expires_at*1000<=Date.now()){session=null;throw new Error('会话已过期，请重新登录')}
 const headers={...(session?{Authorization:'Bearer '+session.access_token}:{}),...options.headers};
 if(options.body!==undefined&&!(options.body instanceof Blob))headers['Content-Type']='application/json';
 const response=await fetch(value.endpoint+'/'+path,{method:options.method||'GET',headers,body:options.body===undefined?undefined:options.body instanceof Blob?options.body:JSON.stringify(options.body),redirect:'error',credentials:'omit'});
 if(options.blob){if(!response.ok)throw failure('文件下载失败',response.status);return response.blob()}
 const result=await response.json();if(!response.ok){if(response.status===401)session=null;throw failure(result.message||'Cloud 请求失败',response.status)}return result;
}
const name=value=>{if(!/^[a-z][a-z0-9_]{0,39}$/.test(value))throw new Error('名称无效');return value};
const filePath=value=>value.split('/').map(encodeURIComponent).join('/');
export const cloud={
 async signUp(email,password){return request('auth/signup',{method:'POST',body:{email,password}})},
 async signIn(email,password){const value=await config(),version=++epoch;const result=value.authMode==='persistent-v1'?await broker('signin',{email,password}):await request('auth/signin',{method:'POST',body:{email,password}});if(version!==epoch)throw new Error('登录操作已中断');session=result;return result},
 async verifyOtp(email,token){const value=await config();const result=value.authMode==='persistent-v1'?await broker('verify',{email,token,type:'email'}):await request('auth/verify',{method:'POST',body:{email,token,type:'email'}});session=result;return result},
 async signOut(){const value=await config();epoch++;restoring=null;const previous=session;session=null;if(value.authMode==='persistent-v1')return broker('signout');if(previous){session=previous;try{await request('auth/signout',{method:'POST'})}finally{session=null}}},
 async getUser(){await restore();if(!session)return null;return request('auth/user')},
 async select(table,query={}){return request('tables/'+name(table)+'?'+new URLSearchParams({select:'*',...query}))},
 async insert(table,values){return request('tables/'+name(table),{method:'POST',body:values})},
 async update(table,id,values){return request('tables/'+name(table)+'?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:values})},
 async remove(table,id){return request('tables/'+name(table)+'?id=eq.'+encodeURIComponent(id),{method:'DELETE'})},
 async upload(bucket,path,file){return request('files/'+name(bucket)+'/'+filePath(path),{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream'}})},
 async download(bucket,path){return request('files/'+name(bucket)+'/'+filePath(path),{blob:true})},
 async removeFile(bucket,path){return request('files/'+name(bucket)+'/'+filePath(path),{method:'DELETE'})},
 async invoke(){throw new Error('共享池暂不支持自定义服务端函数，请选择独立后端')},
};
`
