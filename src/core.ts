export const mm = (n: number): number => n * 72 / 25.4;
export const toMm = (n: number): number => n * 25.4 / 72;
export type Rect = {x:number;y:number;width:number;height:number};
/** Top-left rectangles in upright reading coordinates -> raw output paper coordinates.
 * A 180-degree turn is its own inverse, so previews use this for the reverse mapping too. */
export function rectOnOutput(rect:Rect,width:number,height:number,rotation:0|180):Rect {
  return rotation===180?{...rect,x:width-rect.x-rect.width,y:height-rect.y-rect.height}:{...rect};
}
export interface SourcePage { width:number; height:number; rotation:number; crop:Rect }
export interface DocumentInfo { pages:SourcePage[]; warnings:string[] }
export interface PrintSettings {
  schemaVersion:1; paper:'Letter'|'A4'; trim:'A5'|'A6'|'Half Letter'|'Custom';
  customWidth:number; customHeight:number; unit:'mm'|'in'; scale:'actual'|'fit'; band:number;
  marginTop:number; marginRight:number; marginBottom:number; marginLeft:number;
  mode:'single'|'auto'|'manual'; first:'front'|'back'; flip:'long'|'short'; reverseBacks:boolean;
  offsetX:number; offsetY:number; marks:boolean;
}
export interface PlannedPage {
  source:number|null; sheet:number; side:'front'|'back'; outputRotation:0|180;
  trim:Rect; content:Rect; scale:number;
}
export interface LayoutPlan {
  width:number; height:number; pages:PlannedPage[]; fronts:PlannedPage[]; backs:PlannedPage[];
  sheets:number; errors:string[]; warnings:string[]; settings:PrintSettings;
}
export const defaults:PrintSettings = {
  schemaVersion:1, paper:'Letter', trim:'A5', customWidth:148, customHeight:210, unit:'mm',
  scale:'actual', band:0, marginTop:5,marginRight:5,marginBottom:5,marginLeft:5,
  mode:'auto',first:'front',flip:'long',reverseBacks:false,offsetX:0,offsetY:0,marks:true,
};
const enums:Record<string,unknown[]> = {paper:['Letter','A4'],trim:['A5','A6','Half Letter','Custom'],unit:['mm','in'],scale:['actual','fit'],mode:['single','auto','manual'],first:['front','back'],flip:['long','short']};
export function parseSettings(text:string):PrintSettings {
  const v:unknown=JSON.parse(text);
  if(!v || typeof v!=='object' || Array.isArray(v)) throw Error('Choose a settings JSON object.');
  const o=v as Record<string,unknown>;
  if(Object.keys(o).length!==Object.keys(defaults).length || Object.keys(o).some(k=>!Object.hasOwn(defaults,k))) throw Error('Settings contain missing or unknown fields.');
  if(o.schemaVersion!==1) throw Error('Unsupported settings version.');
  for(const [k,vals] of Object.entries(enums)) if(!vals.includes(o[k])) throw Error(`Invalid ${k}.`);
  for(const k of ['reverseBacks','marks']) if(typeof o[k]!=='boolean') throw Error(`Invalid ${k}.`);
  const ranges:Record<string,[number,number]>={customWidth:[60,210],customHeight:[100,260],band:[0,20],marginTop:[0,20],marginRight:[0,20],marginBottom:[0,20],marginLeft:[0,20],offsetX:[-10,10],offsetY:[-10,10]};
  for(const [k,[min,max]] of Object.entries(ranges)) if(typeof o[k]!=='number'||!Number.isFinite(o[k])||o[k]<min||o[k]>max) throw Error(`${k} must be between ${min} and ${max} mm.`);
  if((o.customWidth as number)>(o.customHeight as number)) throw Error('Custom trim must be portrait.');
  return {...o} as unknown as PrintSettings;
}
export const exportSettings=(s:PrintSettings):string=>JSON.stringify(parseSettings(JSON.stringify(s)),null,2);
export function plan(info:DocumentInfo, input:PrintSettings):LayoutPlan {
  const s=parseSettings(JSON.stringify(input));
  const [width,height]=s.paper==='Letter'?[612,792]:[mm(210),mm(297)];
  const sizes={A5:[148,210],A6:[105,148],'Half Letter':[139.7,215.9],Custom:[s.customWidth,s.customHeight]};
  const [tw,th]=sizes[s.trim].map(mm);
  const trim={x:(width-tw)/2,y:(height-th)/2,width:tw,height:th};
  const errors=new Set<string>(); const warnings=new Set<string>(info.warnings);
  const ids:(number|null)[]=info.pages.map((_,i)=>i);
  if(s.mode!=='single') {if(s.first==='back')ids.unshift(null);if(ids.length%2)ids.push(null);}
  if(!info.pages.length) errors.add('Choose a PDF first.');
  const pages:PlannedPage[]=ids.map((source,index)=>{
    const side=s.mode==='single'||index%2===0?'front':'back';
    const src=info.pages[source??0];
    const availableW=tw-mm(s.band), availableH=th;
    const scale=s.scale==='actual'?1:Math.min(availableW/src.width,availableH/src.height);
    if(s.scale==='actual'&&(src.width>availableW+mm(.1)||src.height>availableH+mm(.1))) errors.add('Actual size does not fit the trim / binding area. Choose Fit whole design or a larger trim.');
    const cw=src.width*scale,ch=src.height*scale;
    const content={x:trim.x+(side==='front'?mm(s.band):0)+(availableW-cw)/2,y:trim.y+(th-ch)/2,width:cw,height:ch};
    if(side==='back') {content.x-=mm(s.offsetX);content.y-=mm(s.offsetY);}
    const outputRotation=side==='back'&&s.flip==='short'?180:0;
    const physical=rectOnOutput(content,width,height,outputRotation);
    if(source!==null&&(physical.x<mm(s.marginLeft)-.001||physical.y<mm(s.marginTop)-.001||physical.x+cw>width-mm(s.marginRight)+.001||physical.y+ch>height-mm(s.marginBottom)+.001)) errors.add('Artwork crosses the printable safe area. Change paper, trim, fit or margins.');
    const markX=trim.x-(side==='back'?mm(s.offsetX):0),markY=trim.y-(side==='back'?mm(s.offsetY):0);
    const physicalTrim=rectOnOutput({x:markX,y:markY,width:tw,height:th},width,height,outputRotation);
    if(source!==null&&s.marks&&(physicalTrim.x-mm(3)<mm(s.marginLeft)||physicalTrim.y-mm(3)<mm(s.marginTop)||physicalTrim.x+tw+mm(3)>width-mm(s.marginRight)||physicalTrim.y+th+mm(3)>height-mm(s.marginBottom)))warnings.add('Some trim marks cross the safe area. You can turn trim marks off.');
    return {source,sheet:s.mode==='single'?index+1:Math.floor(index/2)+1,side,trim:{...trim},content,scale,outputRotation};
  });
  if([s.marginTop,s.marginLeft,s.marginBottom,s.marginRight].includes(0)) warnings.add('A zero safe margin does not make a printer borderless.');
  if(pages.some(p=>p.scale<.8))warnings.add('The design is significantly smaller. Check text readability in a test print.');
  const fronts=pages.filter(p=>p.side==='front'), backs=pages.filter(p=>p.side==='back');
  return {width,height,pages,fronts,backs:s.reverseBacks?[...backs].reverse():backs,sheets:s.mode==='single'?pages.length:pages.length/2,errors:[...errors],warnings:[...warnings],settings:s};
}
