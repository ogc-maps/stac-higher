export interface StacExtension {
  id: string;
  name: string;
  prefix: string;
  version: string;
  description: string;
  schema: Record<string, unknown>;
  source: "local" | "external";
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionPropertyForm {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array";
  description: string;
  required: boolean;
  enumValues?: string;
  arrayItemType?: "string" | "number" | "integer" | "boolean";
  minimum?: string;
  maximum?: string;
  format?: string;
  default?: string;
}

export interface ExtensionFormData {
  name: string;
  prefix: string;
  version: string;
  description: string;
  properties: ExtensionPropertyForm[];
}
