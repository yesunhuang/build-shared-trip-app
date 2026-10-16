// Per-trip presentation only. Never changes the installed application's identity or provider UI.
export const LOGO_BYTES_MAX = 65536;
export const LOGO_EDGE_MAX = 256;
export const LOGO_BASE64_MAX = Math.ceil(LOGO_BYTES_MAX / 3) * 4;
export const BRANDING_PRESETS = Object.freeze({
  default: { ink: "#17362f", accent: "#db7549", background: "#f4efe6" },
  sage: { ink: "#183d2c", accent: "#39734f", background: "#eff6ee" },
  ocean: { ink: "#173b50", accent: "#286582", background: "#edf5fa" },
  plum: { ink: "#482d50", accent: "#7e467d", background: "#f8f0f7" }
});
const HEX = /^#[0-9a-f]{6}$/i;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16));
const hex = values => "#" + values.map(v => Math.round(v).toString(16).padStart(2,"0")).join("");
export function mix(a,b,weight) { return hex(rgb(a).map((v,i) => v*(1-weight)+rgb(b)[i]*weight)); }
export function luminance(value) { return rgb(value).map(v => v/255).map(v => v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0); }
export function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
function keys(value,allowed,path,issues) { for(const key of Object.keys(value))if(!allowed.includes(key))issues.push({path:path+"."+key,message:"field is not allowed"}); }
export function brandingProblems(value) {
  const issues=[];if(value===undefined||value===null)return issues;
  if(!object(value))return [{path:"branding",message:"must be an object or null"}];
  keys(value,["logo","theme"],"branding",issues);
  if(value.logo!==undefined&&value.logo!==null){
    const logo=value.logo;
    if(!object(logo))issues.push({path:"branding.logo",message:"must be a PNG object or null"});
    else {
      keys(logo,["mimeType","data","alt"],"branding.logo",issues);
      if(logo.mimeType!=="image/png")issues.push({path:"branding.logo.mimeType",message:"must be image/png"});
      if(typeof logo.data!=="string"||logo.data.length>LOGO_BASE64_MAX||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(logo.data)||logo.data.length%4!==0)issues.push({path:"branding.logo.data",message:"must be bounded base64 PNG data without a data URL prefix"});
      if(typeof logo.alt!=="string"||!logo.alt.trim()||logo.alt.length>160||/[\u0000-\u001f\u007f]/.test(logo.alt))issues.push({path:"branding.logo.alt",message:"must be 1-160 characters without controls"});
    }
  }
  if(value.theme!==undefined){
    const theme=value.theme;
    if(!object(theme))issues.push({path:"branding.theme",message:"must be a theme object"});
    else if(theme.preset==="custom"){
      keys(theme,["preset","ink","accent","background"],"branding.theme",issues);
      const valid=["ink","accent","background"].every(k=>typeof theme[k]==="string"&&HEX.test(theme[k]));
      if(!valid)issues.push({path:"branding.theme",message:"custom colors must be six-digit hex values"});
      else {
        if(luminance(theme.background)<0.8)issues.push({path:"branding.theme.background",message:"choose a light page color (luminance at least 0.8)"});
        if([theme.background,"#ffffff","#e7e7e7"].some(bg=>contrast(theme.ink,bg)<4.5))issues.push({path:"branding.theme.ink",message:"text contrast must be at least 4.5:1 against the page and light surfaces"});
      }
    } else {
      keys(theme,["preset"],"branding.theme",issues);
      if(!Object.hasOwn(BRANDING_PRESETS,theme.preset))issues.push({path:"branding.theme.preset",message:"choose default, sage, ocean, plum or custom"});
    }
  }
  return issues;
}
export function themeColors(branding) {
  const theme=branding?.theme;
  if(!theme||brandingProblems({theme}).length)return null;
  return theme.preset==="custom"?{ink:theme.ink,accent:theme.accent,background:theme.background}:BRANDING_PRESETS[theme.preset];
}
function darkEnough(value,surfaces,ratio) {
  for(let i=0;i<=100;i++){const candidate=mix(value,"#000000",i/100);if(surfaces.every(bg=>contrast(candidate,bg)>=ratio))return candidate;}
  return "#000000";
}
export function themeTokens(branding) {
  const c=themeColors(branding);if(!c)return null;
  const surfaces=[c.background,"#ffffff","#fffdf8","#e7e7e7"];
  const accent=darkEnough(c.accent,[...surfaces,"#ffffff"],4.5);
  return {ink:c.ink,"ink-2":c.ink,paper:c.background,"paper-2":mix(c.background,"#ffffff",0.4),card:"#ffffff",text:c.ink,
    muted:darkEnough(mix(c.ink,"#ffffff",0.25),surfaces,4.5),line:darkEnough(mix(c.ink,"#ffffff",0.6),surfaces,3),
    accent,"accent-text":accent,"accent-soft":mix(c.accent,"#ffffff",0.94)};
}
const OWNED=["ink","ink-2","paper","paper-2","card","text","muted","line","accent","accent-text","accent-soft","moss","moss-soft","gold","danger","page-surface"];
const defaults=new WeakMap();
export function logoSource(logo) { return logo&&brandingProblems({logo}).length===0?"data:image/png;base64,"+logo.data:""; }
export function applyTripBranding(doc,trip) {
  const root=doc.documentElement;for(const key of OWNED)root.style.removeProperty("--"+key);
  delete root.dataset.tripBranding;
  const branding=trip?.branding;
  if(branding?.theme&&brandingProblems({theme:branding.theme}).length===0){
    root.dataset.tripBranding=branding.theme.preset;
    const tokens=themeTokens(branding);
    if(tokens){for(const [key,value]of Object.entries(tokens))root.style.setProperty("--"+key,value);root.style.setProperty("--page-surface","var(--paper)");}
  } else {
    // Preserve legacy presentation without rewriting stored legacy themes.
    for(const[key,value]of Object.entries(trip?.theme||{}))if(OWNED.includes(key)&&key!=="page-surface"&&/^#[0-9a-f]{3,8}$/i.test(String(value)))root.style.setProperty("--"+key,String(value));
  }
  for(const image of doc.querySelectorAll(".hero-title-icon, .brand--resource .brand-icon")){
    if(!defaults.has(image))defaults.set(image,image.getAttribute("src"));
    const source=logoSource(branding?.logo);
    image.setAttribute("src",source||defaults.get(image));image.alt=source?branding.logo.alt:"";image.dataset.tripLogo=String(Boolean(source));
    if(source)image.removeAttribute("aria-hidden");else image.setAttribute("aria-hidden","true");
  }
}
export const BRANDING_SCHEMA={description:"Per-trip logo and accessible light theme. Missing preserves legacy/default presentation. Logo bytes are embedded in database backups and exports. No global identity, provider, key or permission changes. Use {logo:null,theme:{preset:'default'}} to reset both; omit logo/theme within the object only to select their fallback, not as a merge operation.",anyOf:[{type:"object",additionalProperties:false,properties:{
  logo:{anyOf:[{type:"object",additionalProperties:false,required:["mimeType","data","alt"],properties:{mimeType:{type:"string",const:"image/png"},data:{type:"string",maxLength:LOGO_BASE64_MAX,description:"Base64 of an 8-bit non-interlaced RGB/RGBA PNG, at most 64 KiB and 256 pixels per edge; no data URL, URLs or SVG. Server validates and strips metadata."},alt:{type:"string",minLength:1,maxLength:160}}},{type:"null"}]},
  theme:{anyOf:[{type:"object",additionalProperties:false,required:["preset"],properties:{preset:{type:"string",enum:Object.keys(BRANDING_PRESETS)}}},{type:"object",additionalProperties:false,required:["preset","ink","accent","background"],properties:{preset:{type:"string",const:"custom"},ink:{type:"string",pattern:"^#[0-9a-fA-F]{6}$"},accent:{type:"string",pattern:"^#[0-9a-fA-F]{6}$"},background:{type:"string",pattern:"^#[0-9a-fA-F]{6}$"}}}]}
}},{type:"null"}]};
