// Saved local-photo references, never filenames inferred from itinerary text or remote images.
export const PRIVATE_PHOTO = /^\/photos\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(?:webp|png|jpe?g)$/;
export function localPhotoPaths(value, origin) {
  const found=new Set();
  function visit(node) {
    if(!node || typeof node!=="object")return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    for(const [key,item] of Object.entries(node)){
      if((key==="url"||key==="photoUrl")&&typeof item==="string"){
        let pathname=item;
        if(origin){try{const url=new URL(item,origin);pathname=url.origin===origin?url.pathname:"";}catch{pathname="";}}
        if(PRIVATE_PHOTO.test(pathname))found.add(pathname);
      }
      if(item&&typeof item==="object")visit(item);
    }
  }
  visit(value);return found;
}
