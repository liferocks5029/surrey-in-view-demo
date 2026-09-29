'use strict';
(function(root){
  // Public prototype services; debounce callers >=500ms. Neither guarantees coverage/uptime.
  // https://github.com/bcgov/api-specs/blob/master/geocoder/geocoder-developer-guide.md
  // https://github.com/komoot/photon#demo-server (reasonable use only).
  // BC anonymous GET verified with localhost Origin; no API key or proxy is used.
  let records=[];
  const cache=new Map(),bounds=[-123.45,49,-122.35,49.6];
  const defaultOrigin={lon:-122.8484,lat:49.1887};
  const words={ave:'avenue',av:'avenue',st:'street',rd:'road',blvd:'boulevard',dr:'drive',hwy:'highway',stn:'station',ctr:'centre',center:'centre',groceries:'grocery',universities:'university',parks:'park',hospitals:'hospital',pharmacies:'pharmacy',hotels:'hotel',gyms:'gym',rentals:'rental',stores:'store',centers:'centre',centres:'centre',courts:'court',fields:'field',pools:'pool',rinks:'rink',arenas:'arena',stadiums:'stadium',museums:'museum',galleries:'gallery',neighbourhoods:'neighbourhood',neighborhoods:'neighbourhood',schools:'school',daycares:'childcare',daycare:'childcare',preschools:'preschool'};
  function normalize(value){
    return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/\bsfu\b/g,'simon fraser university').replace(/\bkpu\b/g,'kwantlen polytechnic university').replace(/\bubc\b/g,'university of british columbia').replace(/\bbcit\b/g,'british columbia institute of technology')
      .replace(/\bday\s+care\b/g,'childcare').replace(/\bchild\s+care\b/g,'childcare').replace(/\bhigh\s+schools?\b/g,'secondary school')
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/g,'$1').replace(/[^a-z0-9]+/g,' ').trim()
      .split(/\s+/).map(word=>words[word]||word).join(' ');
  }
  const institutions=['simon fraser university','kwantlen polytechnic university','university of british columbia','british columbia institute of technology'];
  function hasInstitution(record,institution){
    const tokens=institution.split(' ');
    return [record._name,...record._aliases].some(name=>tokens.every(token=>name.split(' ').includes(token)));
  }
  function sameInstitutionAddress(a,b){
    const first=civicParts(a.address),second=civicParts(b.address);
    return first&&second&&first.number===second.number&&first.street===second.street&&
      institutions.some(name=>hasInstitution(a,name)&&hasInstitution(b,name)&&
        [a,b].every(record=>record._name===name||record._name.endsWith(' campus')));
  }
  function valid(lon,lat){return Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=bounds[0]&&lon<=bounds[2]&&lat>=bounds[1]&&lat<=bounds[3];}
  function limitOf(options){return Number.isFinite(options.limit)?Math.max(1,Math.min(50,Math.floor(options.limit))):20;}
  function originOf(options){return valid(options.origin?.lon,options.origin?.lat)?options.origin:defaultOrigin;}
  function abort(signal){if(signal?.aborted){const error=new Error('Address search aborted.');error.name='AbortError';throw error;}}
  function position(feature){
    const geometry=feature.geometry;
    if(!geometry)return null;
    if(geometry.type==='Point'){
      const [lon,lat]=geometry.coordinates||[];
      const p=feature.properties||{};
      const officialPark=['National park','Provincial park','Regional park'].includes(p.CATEGORY)&&String(p.SOURCE_KIND||'').startsWith('official')&&Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=-139&&lon<=-114&&lat>=48&&lat<=60;
      return valid(lon,lat)||officialPark?{lon,lat,locationType:'published point'}:null;
    }
    if(!['Polygon','MultiPolygon'].includes(geometry.type))return null;
    const points=[];
    function walk(coords){if(!Array.isArray(coords))return;if(typeof coords[0]==='number'){if(valid(coords[0],coords[1]))points.push(coords);}else coords.forEach(walk);}
    walk(geometry.coordinates);
    if(!points.length)return null;
    return {lon:(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,
      lat:(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2,locationType:'approximate feature centre'};
  }
  function civicParts(value){
    // A unit prefix is not the building's civic number.
    const text=String(value||'').replace(/^\s*\w+\s*[-–—]\s*(?=\d)/,'');
    const normalized=normalize(text),match=normalized.match(/^(\d+[a-z]?)\s+(.+)$/);
    if(!match||/^(avenue|street|road|boulevard|drive|highway)\b/.test(match[2]))return null;
    return {number:match[1],street:match[2]};
  }
  function indexed(record,{name='',aliases=[],category='',city='',transit=false,civic,streetOnly=false}={}){
    const addressParts=civic===undefined?civicParts(record.address):civic;
    const region=[city,'BC British Columbia Canada'].filter(Boolean).join(' ');
    return {...record,_name:normalize(name),_aliases:aliases.map(normalize).filter(Boolean),_category:normalize(category),
      _terms:normalize([name,record.address,region,category,...aliases].join(' ')),_transit:transit,_streetOnly:streetOnly,_locality:normalize(city),
      _civic:addressParts?{...addressParts,street:normalize([addressParts.street,region].join(' '))}:null};
  }
  function makeRecords(features){
    const list=Array.isArray(features)?features:features?.features||[];
    return list.flatMap((feature,index)=>{
      const p=feature.properties||{},point=position(feature);
      const name=String(p.PARK_NAME||p.PL_NAME||p.NAME||p.name||'');
      const address=String(p.ADDRESS||p.LOCATION||p.address||'');
      if(!point||(!name&&!address))return [];
      const aliases=Array.isArray(p.SEARCH_ALIASES)?[...p.SEARCH_ALIASES]:String(p.SEARCH_ALIASES||'').split(/[;,|]/);
      aliases.push(...({'Ice arena':['ice rink','hockey rink','skating rink'],'Swimming pool':['pool','swimming'],'Athletics track':['running track']}[p.CATEGORY]||[]));
      const sourceUrl=/^https:\/\//i.test(p.SOURCE_URL||'')?p.SOURCE_URL:undefined;
      const transit=p.BUS_STOP_NO!=null||p.STOP_STATUS!=null;
      const city=p.CITY||(['National park','Provincial park'].includes(p.CATEGORY)?'British Columbia':p.SOURCE_DATASET==='metro-regional-parks'||p.SOURCE_KIND==='community'?'Metro Vancouver area':'Surrey');
      const title=name||address,subtitle=[name&&address,city,p.CATEGORY].filter(Boolean).join(' · ');
      return [indexed({id:'local-'+String(feature.id??p.OBJECTID??index),title,subtitle,label:[title,subtitle].filter(Boolean).join(' · '),address,...point,
        source:p.SOURCE_NAME||(sourceUrl?'Verified demo place':'City of Surrey open data'),...(sourceUrl?{sourceUrl}:{}),
        ...(p.LOCATION_BASIS?{locationBasis:p.LOCATION_BASIS}:{})},
      {name:title,aliases,category:transit?'bus stop':p.CATEGORY||(p.PARK_NAME?'Park':''),city,transit})];
    });
  }
  function setFeatures(features){records=makeRecords(features);}
  function tokensMatch(terms,query){
    const available=terms.split(' '),tokens=query.split(' ');
    return tokens.every((token,i)=>available.some(word=>word===token||(i===tokens.length-1&&word.startsWith(token))));
  }
  function distance(record,origin){return Math.hypot((record.lon-origin.lon)*73,(record.lat-origin.lat)*111);}
  function score(record,query,options){
    if(record._transit&&!/\b(bus|stop|transit)\b/.test(query))return -1;
    // An institution's name must match a name/alias, never incidental city/category words.
    if(institutions.some(name=>(' '+query+' ').includes(' '+name+' ')&&!hasInstitution(record,name)))return -1;
    const categoryWords={park:['park','parks'],grocery:['grocery','supermarket','greengrocer'],university:['university'],hospital:['hospital'],hotel:['hotel'],pharmacy:['pharmacy','chemist'],gym:['gym','fitness','fitness_centre'],hardware:['hardware'],furniture:['furniture'],recycling:['recycling','waste_disposal'],"car rental":['car_rental'],school:['elementary school','secondary school','middle school','combined school','other school'],'elementary school':['elementary school','combined school'],'secondary school':['secondary school','combined school'],childcare:['childcare']}[query];
    if(categoryWords){
      // Complete category words mean the kind of destination, not an arbitrary name prefix.
      const category=' '+record._category+' ';
      if(categoryWords.some(word=>category.includes(' '+normalize(word)+' '))){
        let rank=2000;
        if(query==='park'){
          const generic=/^(park|greenbelt|greenway|open space|unnamed)(?: \d+)?$/.test(record._name)||/\b(maintenance|utility|undeveloped|right of way)\b/.test(record._name);
          if(generic)rank=1000;
          else if(record.sourceUrl&&!['Photon / OpenStreetMap','BC Address Geocoder'].includes(record.source))rank=2200;
        }
        return rank-distance(record,originOf(options))*2;
      }
      const names=[record._name,...record._aliases];
      if(!names.some(name=>(' '+name+' ').includes(' '+query+' ')))return -1;
      return 500-Math.min(90,distance(record,originOf(options))*2);
    }
    const civic=civicParts(query);
    if(civic&&(!record._civic||record._civic.number!==civic.number||!tokensMatch(record._civic.street,civic.street)))return -1;
    // A bare number can be a civic prefix or a numbered street; full civic queries remain strict.
    if(/^\d+[a-z]?$/.test(query)){const civicPrefix=record._civic?.number.startsWith(query),streetPrefix=!record._civic&&record.locationType==='street or locality location'&&normalize(record.address).split(' ')[0].startsWith(query);if(!civicPrefix&&!streetPrefix)return -1;}
    if(!tokensMatch(record._terms,query))return -1;
    const names=[record._name,...record._aliases];
    let rank=names.includes(query)?1000:names.some(name=>name.startsWith(query))?900:
      names.some(name=>(' '+name+' ').includes(' '+query+' '))?800:normalize(record.address).startsWith(query)?750:
      tokensMatch(record._category,query)?650:600;
    if(civic)rank+=100;
    if(record.source!=='Photon / OpenStreetMap'&&record.source!=='BC Address Geocoder')rank+=20;
    return rank-Math.min(90,distance(record,originOf(options))*2);
  }
  function publicRecord(record){return Object.fromEntries(Object.entries(record).filter(([key])=>!key.startsWith('_')));}
  function withMore(results,hasMore){Object.defineProperty(results,'hasMore',{value:hasMore,enumerable:false});return results;}
  function ranked(candidates,query,options,rawCount=0){
    const scored=candidates.map(record=>({record,score:score(record,query,options)})).filter(item=>item.score>=0)
      .sort((a,b)=>b.score-a.score||a.record.title.localeCompare(b.record.title));
    const picked=[];
    for(const {record} of scored){
      const duplicate=picked.some(other=>{
        const nearby=distance(record,other)<0.15;
        return (record._streetOnly&&other._streetOnly&&record._name===other._name&&record._locality===other._locality)||
          (record.id===other.id&&record.source===other.source&&distance(record,other)<0.005)||
          (nearby&&record._name===other._name)||
          (nearby&&sameInstitutionAddress(record,other))||
          (nearby&&record.address&&normalize(record.address)===normalize(other.address)&&
            (civicParts(query)||record._name===normalize(record.address)||other._name===normalize(other.address)));
      });
      if(!duplicate)picked.push(record);
      if(picked.length>limitOf(options))break;
    }
    const limit=limitOf(options);
    return withMore(picked.slice(0,limit).map(publicRecord),limit<50&&(picked.length>limit||rawCount>=limit));
  }
  function localSearch(query,options={}){
    abort(options.signal);
    const key=normalize(query);
    return key.length<3?withMore([],false):ranked(options.features?makeRecords(options.features):records,key,options);
  }
  function photonCandidates(payload){
    return (payload?.features||[]).flatMap(feature=>{
      const p=feature.properties||{},[lon,lat]=feature.geometry?.coordinates||[];
      if(feature.geometry?.type!=='Point'||!valid(lon,lat))return [];
      const address=[p.housenumber,p.street].filter(Boolean).join(' '),city=p.city||p.town||p.village||p.district||'';
      const title=p.name||address||city,subtitle=[p.name&&address,city,p.state].filter(Boolean).filter((part,i,all)=>part!==title&&all.indexOf(part)===i).join(' · ');
      if(!title)return [];
      return [indexed({id:'osm-'+p.osm_type+'-'+p.osm_id,title,subtitle,label:[title,subtitle].filter(Boolean).join(' · '),address,lon,lat,
        source:'Photon / OpenStreetMap',locationType:p.housenumber?'address location':p.street?'street or place location':'place location',sourceUrl:'https://www.openstreetmap.org/copyright'},
      {name:title,city,category:[p.osm_value,p.type].filter(Boolean).join(' '),transit:p.osm_value==='bus_stop',streetOnly:p.osm_key==='highway'&&!p.housenumber,
        civic:p.housenumber?{number:normalize(p.housenumber),street:normalize([p.street,city].join(' '))}:null})];
    });
  }
  function bcCandidates(payload){
    return (payload?.features||[]).flatMap(feature=>{
      const p=feature.properties||{},[lon,lat]=feature.geometry?.coordinates||[];
      if(feature.geometry?.type!=='Point'||!valid(lon,lat))return [];
      const precise=['CIVIC_NUMBER','SITE','UNIT'].includes(p.matchPrecision);
      const civicNumber=precise?String(p.civicNumber??''):'';
      const street=[p.streetName,p.streetType,p.streetDirection].filter(Boolean).join(' ');
      const address=p.streetAddress||[civicNumber,street].filter(Boolean).join(' ');
      const title=(precise&&p.siteName)||address||p.fullAddress;
      if(!title)return [];
      const subtitle=[title!==address&&address,p.localityName,'BC'].filter(Boolean).join(' · ');
      return [indexed({id:'bc-'+(p.siteID||p.fullAddress||address),title,subtitle,label:[title,subtitle].join(' · '),address,lon,lat,
        source:'BC Address Geocoder',sourceUrl:'https://www2.gov.bc.ca/gov/content/data/geographic-data-services/location-services/geocoder',
        locationType:precise?'published address point':'street or locality location',locationBasis:p.locationDescriptor||p.locationPositionalAccuracy||''},
      {name:title,city:p.localityName,streetOnly:p.matchPrecision==='STREET',civic:civicNumber?{number:normalize(civicNumber),street:normalize([street,p.localityName].join(' '))}:null})];
    });
  }
  function photonResults(payload){return photonCandidates(payload).map(publicRecord);}
  function bcResults(payload){return bcCandidates(payload).map(publicRecord);}
  async function search(query,options={}){
    abort(options.signal);
    const key=normalize(query),local=options.features?makeRecords(options.features):records;
    if(key.length<3)return withMore([],false);
    if(options.localOnly)return ranked(local,key,options);
    const origin=originOf(options),limit=limitOf(options),provider=/^\d/.test(key)?'bc':'photon';
    const cacheKey=[provider,key,origin.lon.toFixed(4),origin.lat.toFixed(4),limit].join('|');
    const cached=cache.get(cacheKey);
    if(cached&&Date.now()-cached.time<300000)return ranked([...local,...cached.records],key,options,cached.rawCount);
    const url=new URL(provider==='bc'?'https://geocoder.api.gov.bc.ca/addresses.geojson':'https://photon.komoot.io/api/');
    url.search=new URLSearchParams(provider==='bc'?{
      addressString:String(query).trim().slice(0,200),outputSRS:'4326',autoComplete:'true',interpolation:'none',maxResults:String(limit),bbox:bounds.join(',')
    }:{q:key.slice(0,200),limit:String(limit),lat:String(origin.lat),lon:String(origin.lon),bbox:bounds.join(','),lang:'en'}).toString();
    try{
      const response=await (options.fetch||root.fetch)(url.href,{signal:options.signal,credentials:'omit'});
      abort(options.signal);
      if(!response.ok)throw new Error('Address lookup unavailable ('+response.status+').');
      const payload=await response.json();
      abort(options.signal);
      const remote=provider==='bc'?bcCandidates(payload):photonCandidates(payload);
      if(cache.size>=100)cache.delete(cache.keys().next().value);
      const rawCount=Array.isArray(payload?.features)?payload.features.length:0;
      cache.set(cacheKey,{time:Date.now(),records:remote,rawCount});
      return ranked([...local,...remote],key,options,rawCount);
    }catch(error){
      abort(options.signal);
      if(error.name==='AbortError')throw error;
      const fallback=ranked(local,key,options);
      if(fallback.length)return fallback;
      throw new Error('Address lookup is unavailable. Try again or pick a destination on the map.');
    }
  }
  const api={search,setFeatures,normalize,localSearch,photonResults,bcResults};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SurreyAddressSearch=api;
})(typeof window==='object'?window:globalThis);
