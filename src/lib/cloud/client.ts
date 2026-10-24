// This module is generated into candidate source. It contains no management credentials.
export const CLOUD_CLIENT_PATH = 'src/pixloom-cloud.js'
export const cloudClientSource = String.raw`// Pixloom Cloud client. Public configuration is pinned to this build.
let configPromise, session = null;
async function config() {
  if (!configPromise) configPromise = fetch(import.meta.env.BASE_URL + 'pixloom-cloud.json', {cache:'no-store'}).then(async response => {
    if (!response.ok) throw new Error('Cloud 配置未就绪');
    const manifest = await response.json();
    const value = manifest[manifest.environment];
    if (!value || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(value.url)) throw new Error('Cloud 配置无效');
    try { session = JSON.parse(localStorage.getItem('pixloom-auth:' + value.ref) || 'null'); } catch {}
    try { const params=new URLSearchParams(location.hash.slice(1));if(params.get('access_token')) {session={access_token:params.get('access_token'),refresh_token:params.get('refresh_token'),expires_at:Math.floor(Date.now()/1000)+Number(params.get('expires_in')||3600)};try{localStorage.setItem('pixloom-auth:'+value.ref,JSON.stringify(session));}catch{};try{history.replaceState(null,'',location.pathname+location.search);}catch{}} }catch{}
    return {...value, functions: manifest.functions || {}, buckets: manifest.buckets || {}};
  });
  return configPromise;
}
async function saveSession(value) {
  session = value;
  const current = await config();
  try { if (value) localStorage.setItem('pixloom-auth:' + current.ref, JSON.stringify(value)); else localStorage.removeItem('pixloom-auth:' + current.ref); } catch {}
}
async function request(path, options = {}) {
  const current = await config();
  if (session?.refresh_token && session.expires_at * 1000 < Date.now() + 30000 && !options.skipRefresh) {
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {method:'POST',body:{refresh_token:session.refresh_token},skipRefresh:true});
    await saveSession(refreshed);
  }
  const publicAuth=path.startsWith('/auth/v1/token')||path.startsWith('/auth/v1/signup');
  const headers = {apikey:current.publishableKey, ...(!publicAuth && session?.access_token ? {Authorization:'Bearer ' + session.access_token} : {}), ...options.headers};
  if (options.body !== undefined && !(options.body instanceof Blob)) headers['Content-Type'] = 'application/json';
  const response = await fetch(current.url + path, {method:options.method || 'GET',headers,body:options.body === undefined ? undefined : options.body instanceof Blob ? options.body : JSON.stringify(options.body),redirect:'error'});
  const text = await response.text(); let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) throw new Error(result?.msg || result?.message || result?.error_description || 'Cloud 请求失败（' + response.status + '）');
  return result;
}
const name = value => {if (!/^[a-z][a-z0-9_]{0,39}$/.test(value)) throw new Error('名称无效');return value;};
export const cloud = {
  async signUp(email, password) { const result=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(location.href.split('#')[0]),{method:'POST',body:{email,password}});if(result.access_token)await saveSession(result);return result; },
  async signIn(email, password) { const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});await saveSession(result);return result; },
  async signOut() { try { if(session)await request('/auth/v1/logout',{method:'POST'}); } finally { await saveSession(null); } },
  async getUser() { await config();if(!session?.access_token)return null;const result=await request('/auth/v1/user');return result; },
  async select(table, query = {}) { const params=new URLSearchParams({select:'*',...query});return request('/rest/v1/'+name(table)+'?'+params); },
  async insert(table, values) { return request('/rest/v1/'+name(table),{method:'POST',body:values,headers:{Prefer:'return=representation'}}); },
  async update(table, id, values) { return request('/rest/v1/'+name(table)+'?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:values,headers:{Prefer:'return=representation'}}); },
  async remove(table, id) { return request('/rest/v1/'+name(table)+'?id=eq.'+encodeURIComponent(id),{method:'DELETE'}); },
  async invoke(functionName, body) { const current=await config();const slug=current.functions[functionName];if(!slug)throw new Error('函数未部署');return request('/functions/v1/'+slug,{method:'POST',body}); },
  async upload(bucket, path, file) { const current=await config();const user=await cloud.getUser();if(!user)throw new Error('请先登录');const actual=current.buckets[bucket];if(!actual)throw new Error('文件存储未配置');return request('/storage/v1/object/'+encodeURIComponent(actual)+'/'+user.id+'/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream'}}); },
  async download(bucket, path) { const current=await config();const user=await cloud.getUser();if(!user)throw new Error('请先登录');const actual=current.buckets[bucket];if(!actual)throw new Error('文件存储未配置');const response=await fetch(current.url+'/storage/v1/object/authenticated/'+encodeURIComponent(actual)+'/'+user.id+'/'+path.split('/').map(encodeURIComponent).join('/'),{headers:{apikey:current.publishableKey,Authorization:'Bearer '+session.access_token}});if(!response.ok)throw new Error('下载失败');return response.blob(); },
};
`
