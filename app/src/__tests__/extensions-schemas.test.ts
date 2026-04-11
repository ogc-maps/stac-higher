import { describe, it, expect } from "vitest";
import {
  extensionFormSchema,
  extensionPropertySchema,
  formToExtensionSchema,
  extensionToForm,
} from "@/lib/extensions/schemas";
import type { ExtensionFormData } from "@/lib/extensions/types";

describe("extensionPropertySchema", () => {
  it("validates a valid string property", () => {
    const result = extensionPropertySchema.safeParse({
      name: "cloud_cover",
      type: "string",
      description: "Cloud cover percentage",
      required: true,
    });
    expect(result.success).toBe(true);
  });

  it("requires name", () => {
    const result = extensionPropertySchema.safeParse({
      name: "",
      type: "string",
      required: false,
    });
    expect(result.success).toBe(false);
  });

  it("validates type enum", () => {
    const result = extensionPropertySchema.safeParse({
      name: "test",
      type: "invalid",
      required: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("extensionFormSchema", () => {
  const validForm = {
    name: "EO Extension",
    prefix: "eo",
    version: "1.0.0",
    description: "Electro-optical extension",
    properties: [
      {
        name: "cloud_cover",
        type: "number" as const,
        description: "Cloud cover %",
        required: true,
      },
    ],
  };

  it("validates a complete valid form", () => {
    const result = extensionFormSchema.safeParse(validForm);
    expect(result.success).toBe(true);
  });

  it("requires at least one property", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      properties: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires prefix to be lowercase alphanumeric", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      prefix: "EO",
    });
    expect(result.success).toBe(false);
  });

  it("requires prefix to start with a letter", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      prefix: "1eo",
    });
    expect(result.success).toBe(false);
  });

  it("allows underscores in prefix", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      prefix: "my_ext",
    });
    expect(result.success).toBe(true);
  });

  it("requires semver version format", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      version: "1.0",
    });
    expect(result.success).toBe(false);
  });

  it("requires name", () => {
    const result = extensionFormSchema.safeParse({
      ...validForm,
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("formToExtensionSchema", () => {
  const formData: ExtensionFormData = {
    name: "EO Extension",
    prefix: "eo",
    version: "1.0.0",
    description: "Electro-optical extension",
    properties: [
      {
        name: "cloud_cover",
        type: "number",
        description: "Cloud cover percentage",
        required: true,
        minimum: "0",
        maximum: "100",
      },
      {
        name: "bands",
        type: "array",
        description: "Spectral bands",
        required: false,
        arrayItemType: "string",
      },
      {
        name: "constellation",
        type: "string",
        description: "Satellite constellation",
        required: false,
        enumValues: "sentinel-2, landsat-8, modis",
      },
    ],
  };

  it("generates valid JSON Schema structure", () => {
    const schema = formToExtensionSchema(formData);
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("EO Extension Extension");
  });

  it("prefixes property names with extension prefix", () => {
    const schema = formToExtensionSchema(formData);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["eo:cloud_cover"]).toBeDefined();
    expect(props["eo:bands"]).toBeDefined();
    expect(props["eo:constellation"]).toBeDefined();
  });

  it("sets correct types on properties", () => {
    const schema = formToExtensionSchema(formData);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["eo:cloud_cover"].type).toBe("number");
    expect(props["eo:bands"].type).toBe("array");
    expect(props["eo:constellation"].type).toBe("string");
  });

  it("includes min/max for number properties", () => {
    const schema = formToExtensionSchema(formData);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["eo:cloud_cover"].minimum).toBe(0);
    expect(props["eo:cloud_cover"].maximum).toBe(100);
  });

  it("includes array item type", () => {
    const schema = formToExtensionSchema(formData);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["eo:bands"].items).toEqual({ type: "string" });
  });

  it("includes enum values", () => {
    const schema = formToExtensionSchema(formData);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["eo:constellation"].enum).toEqual([
      "sentinel-2",
      "landsat-8",
      "modis",
    ]);
  });

  it("includes required array for required properties", () => {
    const schema = formToExtensionSchema(formData);
    expect(schema.required).toEqual(["eo:cloud_cover"]);
  });

  it("omits required when no properties are required", () => {
    const schema = formToExtensionSchema({
      ...formData,
      properties: formData.properties.map((p) => ({ ...p, required: false })),
    });
    expect(schema.required).toBeUndefined();
  });

  it("sets $id when schemaUrl is provided", () => {
    const schema = formToExtensionSchema(
      formData,
      "http://localhost:4321/api/extensions/123/schema",
    );
    expect(schema.$id).toBe(
      "http://localhost:4321/api/extensions/123/schema",
    );
  });
});

describe("extensionToForm", () => {
  it("round-trips through formToExtensionSchema", () => {
    const original: ExtensionFormData = {
      name: "Test Extension",
      prefix: "test",
      version: "2.0.0",
      description: "A test extension",
      properties: [
        {
          name: "value",
          type: "number",
          description: "A numeric value",
          required: true,
          minimum: "0",
          maximum: "100",
        },
        {
          name: "tags",
          type: "array",
          description: "Tag list",
          required: false,
          arrayItemType: "string",
        },
      ],
    };

    const schema = formToExtensionSchema(original);
    const roundTripped = extensionToForm({
      name: original.name,
      prefix: original.prefix,
      version: original.version,
      description: original.description,
      schema,
    });

    expect(roundTripped.name).toBe(original.name);
    expect(roundTripped.prefix).toBe(original.prefix);
    expect(roundTripped.version).toBe(original.version);
    expect(roundTripped.description).toBe(original.description);
    expect(roundTripped.properties).toHaveLength(2);

    const valueProp = roundTripped.properties.find((p) => p.name === "value");
    expect(valueProp?.type).toBe("number");
    expect(valueProp?.required).toBe(true);
    expect(valueProp?.minimum).toBe("0");
    expect(valueProp?.maximum).toBe("100");

    const tagsProp = roundTripped.properties.find((p) => p.name === "tags");
    expect(tagsProp?.type).toBe("array");
    expect(tagsProp?.arrayItemType).toBe("string");
    expect(tagsProp?.required).toBe(false);
  });

  it("handles properties without prefix separator", () => {
    const result = extensionToForm({
      name: "Simple",
      prefix: "s",
      version: "1.0.0",
      description: "",
      schema: {
        properties: {
          plain_key: { type: "string", description: "no prefix" },
        },
      },
    });
    expect(result.properties[0].name).toBe("plain_key");
  });
});
