import { describe, expect, it } from 'vitest';
import { defaults, mm, toMm, plan, parseSettings, exportSettings } from '../src/core';

const doc = (count = 7, width = 148, height = 210) => ({ pages: Array.from({length: count}, () => ({ width:mm(width), height:mm(height), rotation:0, crop:{x:0,y:0,width:mm(width),height:mm(height)} })), warnings:[] });
const settings = (patch: any = {}) => ({...defaults, ...patch});
describe('physical print contract', () => {
  it('centres A5 on A4 at 31 / 43.5 mm', () => {
    const p=plan(doc(),settings({paper:'A4'}));
    expect(toMm(p.pages[0].trim.x)).toBeCloseTo(31,8);
    expect(toMm(p.pages[0].trim.y)).toBeCloseTo(43.5,8);
    expect(toMm(p.width)).toBeCloseTo(210,8);
  });
  it('centres A5 on Letter at 33.95 / 34.7 mm', () => {
    const p=plan(doc(),settings());
    expect(p.width).toBe(612); expect(p.height).toBe(792);
    expect(toMm(p.pages[0].trim.x)).toBeCloseTo(33.95,8);
    expect(toMm(p.pages[0].trim.y)).toBeCloseTo(34.7,8);
  });
  it('fits the whole A5 into Half Letter without stretching', () => {
    const p=plan(doc(),settings({trim:'Half Letter',scale:'fit'})).pages[0];
    expect(p.scale).toBeCloseTo(0.9439189189,9);
    expect(toMm(p.content.width)).toBeCloseTo(139.7,8);
    expect(toMm(p.content.height)).toBeCloseTo(198.22297297,7);
  });
  it('blocks actual size rather than silently shrinking', () => {
    expect(plan(doc(),settings({trim:'A6'})).errors.join(' ')).toMatch(/Actual size/);
  });
  it('mirrors the binding band by logical side, keeping content whole', () => {
    const p=plan(doc(),settings({band:8,scale:'fit'}));
    expect(p.pages[0].content.x).toBeGreaterThan(p.pages[1].content.x);
    expect(p.pages[0].scale).toBe(p.pages[1].scale);
  });
  it('pads seven duplex pages to four sheets', () => {
    const p=plan(doc(),settings());
    expect(p.pages.map((v:any)=>v.source)).toEqual([0,1,2,3,4,5,6,null]);
    expect(p.sheets).toBe(4); expect(p.pages[7].side).toBe('back');
  });
  it('does not pad or compensate seven simplex pages', () => {
    const p=plan(doc(),settings({mode:'single',offsetX:2,offsetY:1}));
    expect(p.pages).toHaveLength(7); expect(p.pages[1].side).toBe('front');
    expect(p.pages[0].content).toEqual(p.pages[1].content);
  });
  it('inserts front and trailing blank when first input is a back', () => {
    const p=plan(doc(4),settings({first:'back'}));
    expect(p.pages.map((v:any)=>v.source)).toEqual([null,0,1,2,3,null]);
    expect(p.pages[1].side).toBe('back'); expect(p.sheets).toBe(3);
  });
  it('retains every source page, including blanks', () => {
    expect(plan(doc(3),settings()).pages.map((v:any)=>v.source)).toEqual([0,1,2,null]);
  });
  it('provides physical-sheet fronts and reversible backs', () => {
    const p=plan(doc(),settings({mode:'manual',reverseBacks:true}));
    expect(p.fronts.map((v:any)=>v.source)).toEqual([0,2,4,6]);
    expect(p.backs.map((v:any)=>v.source)).toEqual([null,5,3,1]);
    expect(p.backs.map((v:any)=>v.sheet)).toEqual([4,3,2,1]);
  });
  it('compensates observed right/down displacement in upright coordinates', () => {
    const p=plan(doc(),settings({offsetX:2,offsetY:1}));
    expect(toMm(p.pages[1].content.x-p.pages[0].content.x)).toBeCloseTo(-2,8);
    expect(toMm(p.pages[1].content.y-p.pages[0].content.y)).toBeCloseTo(-1,8);
  });
  it('rotates only output backs on short-edge', () => {
    const p=plan(doc(),settings({flip:'short',offsetX:2}));
    expect(p.pages[0].outputRotation).toBe(0); expect(p.pages[1].outputRotation).toBe(180);
    expect(toMm(p.pages[1].content.x-p.pages[0].content.x)).toBeCloseTo(-2,8);
  });
  it('blocks artwork outside the physical safe area', () => {
    const p=plan(doc(1,210,260),settings({paper:'A4',trim:'Custom',customWidth:210,customHeight:260}));
    expect(p.errors.join(' ')).toMatch(/safe area/);
  });
  it.each([{offsetX:11},{offsetY:-11},{band:21},{customWidth:NaN},{marginTop:-1}])('rejects invalid numeric setting %j', patch => {
    expect(()=>parseSettings(JSON.stringify({...defaults,...patch}))).toThrow();
  });
  it('rejects wrong versions, extra fields and nonobjects', () => {
    for(const s of [{...defaults,schemaVersion:2},{...defaults,fileName:'secret.pdf'},null,[]])
      expect(()=>parseSettings(JSON.stringify(s))).toThrow();
  });
  it('round trips only pure settings', () => {
    const text=exportSettings(defaults); expect(parseSettings(text)).toEqual(defaults);
    expect(text).not.toMatch(/fileName|filePath|hash|bytes|textContent/);
  });
  it('warns when compensated trim marks cross a safe edge',()=>{
    const p=plan(doc(2,148,210),settings({customWidth:185,customHeight:260,trim:'Custom',offsetX:10,marks:true}));
    expect(p.warnings.join(' ')).toMatch(/trim marks/);
  });
  it('blocks the review counterexample after short-edge output rotation',()=>{
    const p=plan(doc(1,190,240),settings({trim:'Custom',customWidth:210,customHeight:260,band:20,first:'back',flip:'short',marginLeft:0,marginRight:20,marginTop:0,marginBottom:0,marks:false}));
    expect(p.errors.join(' ')).toMatch(/safe area/);
  });
  it.each([
    {flip:'long',offsetX:0,offsetY:0,marginLeft:0,marginRight:20,marginTop:0,marginBottom:0,blocked:false},
    {flip:'short',offsetX:0,offsetY:0,marginLeft:20,marginRight:0,marginTop:0,marginBottom:0,blocked:false},
    {flip:'short',offsetX:2,offsetY:1,marginLeft:0,marginRight:20,marginTop:0,marginBottom:0,blocked:true},
    {flip:'short',offsetX:2,offsetY:1,marginLeft:20,marginRight:0,marginTop:20,marginBottom:0,blocked:false},
    {flip:'short',offsetX:2,offsetY:-1,marginLeft:0,marginRight:0,marginTop:20,marginBottom:0,blocked:true},
    {flip:'long',offsetX:2,offsetY:1,marginLeft:0,marginRight:0,marginTop:20,marginBottom:0,blocked:true},
  ])('checks physical margins with binding/offset combination %j',({blocked,...patch})=>{
    const p=plan(doc(1,190,240),settings({trim:'Custom',customWidth:210,customHeight:260,band:20,first:'back',marks:false,...patch}));
    expect(p.errors.some((e:string)=>e.includes('safe area'))).toBe(blocked);
  });
  it.each([{marginLeft:0,marginRight:5,warn:true},{marginLeft:5,marginRight:0,warn:false}])('checks compensated trim marks in physical orientation %j',({warn,...patch})=>{
    const p=plan(doc(1),settings({trim:'Custom',customWidth:185,customHeight:260,first:'back',flip:'short',offsetX:10,marginTop:0,marginBottom:0,marks:true,...patch}));
    expect(p.errors).toEqual([]);
    expect(p.warnings.some((w:string)=>w.includes('trim marks'))).toBe(warn);
  });
});
