// Generated fictional raster artwork, never a real travel logo.
import {deflateSync} from "node:zlib";
import {pngChunk} from "../../server/domain/branding.mjs";
export function fictionalLogo({width=24,height=24,colorType=6,raw,extra=[],tail=Buffer.alloc(0)}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=colorType;
  const channels=colorType===6?4:3;
  raw||=Buffer.concat(Array.from({length:height},(_,y)=>Buffer.concat([Buffer.from([0]),Buffer.concat(Array.from({length:width},(_,x)=>Buffer.from(channels===4?[40+x%80,100+y%80,70,255]:[40+x%80,100+y%80,70])))])));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),...extra.map(([name,bytes])=>pngChunk(name,bytes)),pngChunk("IDAT",deflateSync(raw)),pngChunk("IEND",Buffer.alloc(0)),tail]);
}
export const logoObject=()=>({mimeType:"image/png",data:fictionalLogo().toString("base64"),alt:"Fictional leaf symbol"});
