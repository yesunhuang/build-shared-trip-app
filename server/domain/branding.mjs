// Bounded raster-only logo validation. Re-encode IDAT and remove all ancillary metadata.
import {inflateSync,deflateSync} from "node:zlib";
import {brandingProblems,LOGO_BYTES_MAX,LOGO_EDGE_MAX} from "../../assets/app-template/public/trip-branding.js";
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
export function pngCrc(bytes) { let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0; }
export function pngChunk(type,data) {const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(pngCrc(Buffer.concat([name,data])),data.length+8);return out;}
export function sanitizeLogoData(data) {
  const bytes=Buffer.from(data,"base64");if(bytes.length>LOGO_BYTES_MAX||bytes.toString("base64")!==data||!bytes.subarray(0,8).equals(signature))throw Error("png");
  let pos=8,header,ended=false,idatEnded=false;const image=[];
  while(pos<bytes.length){
    if(pos+12>bytes.length)throw Error("png");const size=bytes.readUInt32BE(pos);if(size>LOGO_BYTES_MAX||pos+size+12>bytes.length)throw Error("png");
    const type=bytes.toString("latin1",pos+4,pos+8),part=bytes.subarray(pos+8,pos+8+size);if(!/^[A-Za-z]{4}$/.test(type)||pngCrc(bytes.subarray(pos+4,pos+8+size))!==bytes.readUInt32BE(pos+8+size))throw Error("png");
    if(!header&&type!=="IHDR")throw Error("png");
    if(type==="IHDR"){
      if(header||size!==13)throw Error("png");header=Buffer.from(part);const width=part.readUInt32BE(0),height=part.readUInt32BE(4);
      if(!width||!height||width>LOGO_EDGE_MAX||height>LOGO_EDGE_MAX||part[8]!==8||![2,6].includes(part[9])||part[10]||part[11]||part[12])throw Error("png");
    }else if(type==="IDAT"){if(idatEnded)throw Error("png");image.push(part);}
    else if(type==="IEND"){if(size||!image.length)throw Error("png");ended=true;pos+=12;break;}
    else {if(image.length)idatEnded=true;if(["acTL","fcTL","fdAT","tRNS"].includes(type)||type[0]===type[0].toUpperCase())throw Error("png");}
    pos+=size+12;
  }
  if(!ended||pos!==bytes.length)throw Error("png");
  const row=header.readUInt32BE(0)*(header[9]===6?4:3)+1,expected=row*header.readUInt32BE(4);
  const raw=inflateSync(Buffer.concat(image),{maxOutputLength:expected+1});if(raw.length!==expected)throw Error("png");
  for(let i=0;i<raw.length;i+=row)if(raw[i]>4)throw Error("png");
  const clean=Buffer.concat([signature,pngChunk("IHDR",header),pngChunk("IDAT",deflateSync(raw)),pngChunk("IEND",Buffer.alloc(0))]);
  if(clean.length>LOGO_BYTES_MAX)throw Error("png");return clean.toString("base64");
}
export function normalizeBranding(raw,path,issues) {
  if(raw===undefined||raw===null)return undefined;
  const problems=brandingProblems(raw);for(const problem of problems)issues.add(path+problem.path.slice("branding".length),problem.message);
  if(problems.length)return undefined;
  const out={};if(Object.hasOwn(raw,"theme"))out.theme={...raw.theme};
  if(Object.hasOwn(raw,"logo")){
    if(raw.logo===null)out.logo=null;
    else try{out.logo={mimeType:"image/png",data:sanitizeLogoData(raw.logo.data),alt:raw.logo.alt.trim()};}catch{issues.add(path+".logo.data","use a valid non-animated 8-bit RGB/RGBA PNG, at most 64 KiB and 256 pixels per edge; use the editor to convert other images");}
  }
  return out;
}
