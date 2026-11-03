export interface SeoMetadata {
 site:string;
 canonical:string;
 title:string;
 description:string;
 breadcrumb?:string;
 indexable?:boolean;
}
export function renderSeoMetadata(input:SeoMetadata):string;
