import { z } from "zod";
import type { ExtensionFormData, ExtensionPropertyForm } from "./types";

export const extensionPropertySchema = z.object({
  name: z.string().min(1, "Property name is required"),
  type: z.enum(["string", "number", "integer", "boolean", "array"]),
  description: z.string().default(""),
  required: z.boolean().default(false),
  enumValues: z.string().optional(),
  arrayItemType: z.enum(["string", "number", "integer", "boolean"]).optional(),
  minimum: z.string().optional(),
  maximum: z.string().optional(),
  format: z.string().optional(),
  default: z.string().optional(),
});

export const extensionFormSchema = z.object({
  name: z.string().min(1, "Extension name is required"),
  prefix: z
    .string()
    .min(1, "Prefix is required")
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Prefix must be lowercase alphanumeric with underscores, starting with a letter",
    ),
  version: z
    .string()
    .min(1, "Version is required")
    .regex(
      /^\d+\.\d+\.\d+$/,
      "Version must be semver format (e.g., 1.0.0)",
    ),
  description: z.string().default(""),
  properties: z
    .array(extensionPropertySchema)
    .min(1, "At least one property is required"),
});

export type ExtensionFormValues = z.infer<typeof extensionFormSchema>;

function propertyToJsonSchema(
  prop: ExtensionPropertyForm,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: prop.type };

  if (prop.description) {
    schema.description = prop.description;
  }

  if (prop.enumValues?.trim()) {
    const values = prop.enumValues
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) {
      schema.enum =
        prop.type === "number" || prop.type === "integer"
          ? values.map(Number)
          : values;
    }
  }

  if (prop.type === "number" || prop.type === "integer") {
    if (prop.minimum?.trim()) schema.minimum = Number(prop.minimum);
    if (prop.maximum?.trim()) schema.maximum = Number(prop.maximum);
  }

  if (prop.type === "string" && prop.format?.trim()) {
    schema.format = prop.format.trim();
  }

  if (prop.type === "array" && prop.arrayItemType) {
    schema.items = { type: prop.arrayItemType };
  }

  if (prop.default?.trim()) {
    try {
      schema.default = JSON.parse(prop.default);
    } catch {
      schema.default = prop.default;
    }
  }

  return schema;
}

export function formToExtensionSchema(
  data: ExtensionFormData,
  schemaUrl?: string,
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const prop of data.properties) {
    const key = `${data.prefix}:${prop.name}`;
    properties[key] = propertyToJsonSchema(prop);
    if (prop.required) {
      required.push(key);
    }
  }

  const schema: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `${data.name} Extension`,
    description: data.description || `${data.name} Extension for STAC`,
    type: "object",
    properties,
  };

  if (schemaUrl) {
    schema.$id = schemaUrl;
  }

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

export function extensionToForm(ext: {
  name: string;
  prefix: string;
  version: string;
  description: string;
  schema: Record<string, unknown>;
}): ExtensionFormData {
  const properties: ExtensionPropertyForm[] = [];
  const schemaProps = (ext.schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const requiredFields = (ext.schema.required ?? []) as string[];

  for (const [key, propSchema] of Object.entries(schemaProps)) {
    const name = key.includes(":") ? key.split(":").slice(1).join(":") : key;
    const type = (propSchema.type as ExtensionPropertyForm["type"]) ?? "string";

    const prop: ExtensionPropertyForm = {
      name,
      type,
      description: (propSchema.description as string) ?? "",
      required: requiredFields.includes(key),
    };

    if (propSchema.enum) {
      prop.enumValues = (propSchema.enum as unknown[]).join(", ");
    }

    if (type === "array" && propSchema.items) {
      const items = propSchema.items as Record<string, unknown>;
      prop.arrayItemType = items.type as ExtensionPropertyForm["arrayItemType"];
    }

    if (propSchema.minimum !== undefined) {
      prop.minimum = String(propSchema.minimum);
    }
    if (propSchema.maximum !== undefined) {
      prop.maximum = String(propSchema.maximum);
    }
    if (propSchema.format) {
      prop.format = propSchema.format as string;
    }
    if (propSchema.default !== undefined) {
      prop.default =
        typeof propSchema.default === "string"
          ? propSchema.default
          : JSON.stringify(propSchema.default);
    }

    properties.push(prop);
  }

  return {
    name: ext.name,
    prefix: ext.prefix,
    version: ext.version,
    description: ext.description,
    properties,
  };
}
