import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const url=process.argv[2]||process.env.SHARED_TRIP_MCP_URL;
const token=process.env.SHARED_TRIP_ADMIN_TOKEN;
if(!url||!token)throw new Error("Set SHARED_TRIP_ADMIN_TOKEN and provide an MCP endpoint URL. Use disposable test storage.");
const client=new Client({name:"shared-trip-smoke",version:"1.0.0"});
try{
  await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:"Bearer "+token}}}));
  const names=(await client.listTools()).tools.map((t)=>t.name);
  console.log("MCP connected. Tools: "+names.join(", "));
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw new Error("Tool returned an error.");return result.structuredContent||JSON.parse(result.content[0].text);};
  const {trip}=await call("create_trip",{requestId:crypto.randomUUID(),trip:{title:"Fictional MCP smoke trip"}});
  const read=await call("get_trip",{tripId:trip.id});
  await call("apply_trip_changes",{tripId:trip.id,expectedVersion:read.trip.version,requestId:crypto.randomUUID(),changes:[{type:"upsert_day",day:{date:"2030-06-01"}},{type:"upsert_reminder",reminder:{item:"Fictional reminder",done:false}}]});
  const final=await call("get_trip",{tripId:trip.id});
  if(final.trip.days.length!==1||final.trip.reminders.length!==1)throw new Error("Read/write verification failed.");
  console.log("Fictional creation, mutation and readback passed. The fictional test trip remains in the selected storage.");
}finally{await client.close();}
