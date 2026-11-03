import {it,expect} from 'vitest';
import {renderSeoMetadata} from '../scripts/seo-metadata.mjs';
const site='https://plannerprintprep.com/';
const input={site,canonical:site+'guides/a5-vs-half-letter/',title:'A5 vs Half Letter | Planner Print Prep',description:'Compare paper sizes & preserve your PDF.',breadcrumb:'A5 vs Half Letter',indexable:true};
function graph(html:string){const match=/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html);expect(match).not.toBeNull();return JSON.parse(match![1])['@graph'];}
it('connects a guide to the actual website and visible breadcrumb without inventing ratings',()=>{
 const html=renderSeoMetadata(input),nodes=graph(html);
 expect(nodes.find((n:any)=>n['@type']==='WebSite').url).toBe(site);
 const page=nodes.find((n:any)=>n['@type']==='WebPage');expect(page.url).toBe(input.canonical);expect(page.isPartOf['@id']).toBe(site+'#website');
 const crumbs=nodes.find((n:any)=>n['@type']==='BreadcrumbList').itemListElement;
 expect(crumbs.map((c:any)=>[c.position,c.name,c.item])).toEqual([[1,'Print workspace',site],[2,input.breadcrumb,input.canonical]]);
 expect(html).not.toMatch(/aggregateRating|ratingValue|FAQPage|Review/);
});
it('serializes text safely for both meta attributes and JSON-LD',()=>{
 const html=renderSeoMetadata({...input,title:'Size "A" </script><img src=x>',description:'Keep <text> & "vectors"'});
 expect(html).not.toContain('<img src=x>');expect(html.match(/<\/script>/g)).toHaveLength(1);
 expect(graph(html).find((n:any)=>n['@type']==='WebPage').description).toBe('Keep <text> & "vectors"');
 expect(html).toContain('Size &quot;A&quot; &lt;/script&gt;&lt;img src=x&gt;');
});
it('keeps preview pages out of structured search data and omits a false home breadcrumb',()=>{
 expect(renderSeoMetadata({...input,indexable:false})).not.toContain('application/ld+json');
 const home=graph(renderSeoMetadata({...input,canonical:site,breadcrumb:undefined}));
 expect(home.some((n:any)=>n['@type']==='BreadcrumbList')).toBe(false);
});
it('uses the configured project base for canonical identities and breadcrumb links',()=>{
 const sub='https://example.test/planner/';
 const nodes=graph(renderSeoMetadata({...input,site:sub,canonical:sub+'pricing/'}));
 expect(nodes.find((n:any)=>n['@type']==='BreadcrumbList').itemListElement[0].item).toBe(sub);
 expect(nodes.find((n:any)=>n['@type']==='WebSite')['@id']).toBe(sub+'#website');
});
