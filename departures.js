import { json, loadTodaySchedule, madridEpoch, stationFallback, tripsFeed, vehiclesFeed } from './_shared.js';

export default async function handler(req,res){
  try {
    const {schedule,cache}=await loadTodaySchedule();
    const ids=new Set(schedule.stations.map(s=>s.id));
    const origin=ids.has(String(req.query.origin))?String(req.query.origin):'78706';
    const dest=ids.has(String(req.query.destination))&&req.query.destination!==origin?String(req.query.destination):(origin==='78706'?'71801':'78706');
    const now=Math.floor(Date.now()/1000);
    const [tr,vr]=await Promise.all([fetch(tripsFeed,{cache:'no-store'}),fetch(vehiclesFeed,{cache:'no-store'})]);
    if(!tr.ok) throw new Error(`Feed de horarios en tiempo real de Renfe no disponible (${tr.status}).`);
    const [tu,vp]=await Promise.all([tr.json(),vr.ok?vr.json():Promise.resolve({entity:[]})]);
    const updates=new Map((tu.entity||[]).map(e=>[e.tripUpdate?.trip?.tripId,e.tripUpdate]).filter(([id])=>id));
    const vehicles=new Map((vp.entity||[]).map(e=>[e.vehicle?.trip?.tripId,e.vehicle]).filter(([id])=>id));
    const items=[];
    for(const t of schedule.trips){
      const oi=t.stops.findIndex(s=>s[0]===origin),di=t.stops.findIndex(s=>s[0]===dest);
      if(oi<0||di<=oi) continue;
      const os=t.stops[oi],ds=t.stops[di],update=updates.get(t.tripId),vehicle=vehicles.get(t.tripId);
      const planned=madridEpoch(schedule.date.replaceAll('-',''),os[3]);
      const arrival=madridEpoch(schedule.date.replaceAll('-',''),ds[2]);
      const relation=update?.trip?.scheduleRelationship||'SCHEDULED';
      const cancelled=['CANCELED','DELETED'].includes(relation);
      const ou=update?.stopTimeUpdate?.find(x=>x.stopId===origin),du=update?.stopTimeUpdate?.find(x=>x.stopId===dest);
      const predicted=Number(ou?.departure?.time||ou?.arrival?.time)||planned+Number(ou?.departure?.delay??ou?.arrival?.delay??update?.delay??0);
      const predictedArrival=Number(du?.arrival?.time||du?.departure?.time)||arrival+Number(du?.arrival?.delay??du?.departure?.delay??update?.delay??0);
      if(cancelled?(planned<now-60||planned>now+3600):(predicted<now-60||predicted>now+3600))continue;
      const current=vehicle?t.stops.findIndex(s=>s[0]===vehicle.stopId):-1;
      const from=current>=0&&current<=oi?current:oi;
      const timeline=t.stops.slice(from,oi+1).map(s=>{const u=update?.stopTimeUpdate?.find(z=>z.stopId===s[0]);const pt=madridEpoch(schedule.date.replaceAll('-',''),s[2]);return{id:s[0],name:s[1],predicted:Number(u?.arrival?.time||u?.departure?.time)||pt+Number(u?.arrival?.delay??u?.departure?.delay??update?.delay??0),current:s[0]===vehicle?.stopId}});
      items.push({tripId:t.tripId,planned,predicted,plannedArrival:arrival,predictedArrival,delaySeconds:predicted-planned,cancelled,realtime:Boolean(update),position:vehicle?{stopId:vehicle.stopId,stopName:t.stops.find(s=>s[0]===vehicle.stopId)?.[1]||vehicle.stopId,status:vehicle.currentStatus,platform:vehicle.vehicle?.label?.match(/PLATF\.\(([^)]+)\)/)?.[1]||null}:null,timeline});
    }
    items.sort((a,b)=>a.predicted-b.predicted);
    const byId=new Map(schedule.stations.map(s=>[s.id,s]));
    return json(res,{origin:byId.get(origin)||stationFallback[0],destination:byId.get(dest)||stationFallback[1],generatedAt:now,feedTimestamp:Number(tu.header?.timestamp||0),realtimeAvailable:true,serviceDate:schedule.date,scheduleFetchedAt:schedule.fetchedAt,scheduleCache:cache,items:items.slice(0,5)});
  }catch(error){return json(res,{error:error.message,realtimeAvailable:false,items:[]},503)}
}
