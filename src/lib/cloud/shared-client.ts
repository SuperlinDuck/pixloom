// Generated application client: only app-scoped opaque sessions ever reach the browser.
export const sharedClientSource = String.raw`// Pixloom shared Cloud client. Sessions stay in memory.
let configPromise, session=null;
async function config(){
 if(!configPromise)configPromise=fetch(import.meta.env.BASE_URL+'pixloom-cloud.json',{cache:'no-store'}).then(async response=>{
  if(!response.ok)throw new Error('Cloud 配置未就绪');const value=await response.json();
  const url=new URL(value.endpoint);if(value.format!=='pixloom-cloud-v2'||url.pathname!=='/cloud/v2/apps/'+value.projectId+'/environments/'+value.environment+'/'+value.generation||url.search||url.hash||url.username||url.password)throw new Error('Cloud 配置无效');return value;
 });return configPromise;
}
async function request(path,options={}){
 const value=await config();if(session&&session.expires_at*1000<=Date.now()){session=null;throw new Error('会话已过期，请重新登录')}
 const headers={...(session?{Authorization:'Bearer '+session.access_token}:{}),...options.headers};
 if(options.body!==undefined&&!(options.body instanceof Blob))headers['Content-Type']='application/json';
 const response=await fetch(value.endpoint+'/'+path,{method:options.method||'GET',headers,body:options.body===undefined?undefined:options.body instanceof Blob?options.body:JSON.stringify(options.body),redirect:'error',credentials:'omit'});
 if(options.blob){if(!response.ok)throw new Error('文件下载失败');return response.blob()}
 const result=await response.json();if(!response.ok){if(response.status===401)session=null;throw new Error(result.message||'Cloud 请求失败')}return result;
}
const name=value=>{if(!/^[a-z][a-z0-9_]{0,39}$/.test(value))throw new Error('名称无效');return value};
const filePath=value=>value.split('/').map(encodeURIComponent).join('/');
export const cloud={
 async signUp(email,password){return request('auth/signup',{method:'POST',body:{email,password}})},
 async signIn(email,password){const result=await request('auth/signin',{method:'POST',body:{email,password}});session=result;return result},
 async verifyOtp(email,token){const result=await request('auth/verify',{method:'POST',body:{email,token,type:'email'}});session=result;return result},
 async signOut(){try{if(session)await request('auth/signout',{method:'POST'})}finally{session=null}},
 async getUser(){await config();if(!session)return null;return request('auth/user')},
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
