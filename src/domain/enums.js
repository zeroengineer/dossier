// Shared enumerations used by the workspace schemas, services and templates (one definition each).
import { LEVELS } from './sensitivity.js';

/** Sensitivity levels / user clearances, lowest first. */
export const CLEARANCES = LEVELS;
/** Entity kinds in the master list. */
export const ENTITY_KINDS = Object.freeze(['company', 'group_entity', 'person', 'client', 'vendor', 'product', 'business_line', 'engagement', 'financial_year']);
/** Roles of an entity–entity relation. */
export const ENTITY_RELATION_ROLES = Object.freeze(['employed_by', 'director_of', 'belongs_to_business_line', 'engagement_of', 'vendor_of', 'product_of', 'group_entity_of', 'signatory_of', 'contact_of']);
/** Rendition kinds (one per kind per version). */
export const RENDITION_KINDS = Object.freeze(['pdf', 'html', 'md', 'original']);
/** Document relation types. */
export const DOCUMENT_RELATION_TYPES = Object.freeze(['based_on', 'pays', 'settles', 'adjusts', 'follows', 'generated_from', 'supersedes', 'rendition_of']);
/** Roles an entity can play on a document. */
export const DOCUMENT_ENTITY_ROLES = Object.freeze(['party', 'signatory', 'named', 'contact', 'issuer']);
/** Party types (documents.party_type). */
export const PARTY_TYPES = Object.freeze(['Company', 'GroupEntity', 'Person', 'Client', 'Vendor', 'Product']);
/** Template categories (template.json `category`). */
export const TEMPLATE_CATEGORIES = Object.freeze(['invoice', 'letter', 'statement', 'agreement', 'proposal', 'report', 'resolution']);
/** Renditions a template can produce. */
export const TEMPLATE_RENDITIONS = Object.freeze(['pdf', 'html', 'md']);
/** Field types in template.json. */
export const FIELD_TYPES = Object.freeze(['string', 'text', 'date', 'money', 'number', 'enum', 'entity', 'array', 'object', 'boolean']);
