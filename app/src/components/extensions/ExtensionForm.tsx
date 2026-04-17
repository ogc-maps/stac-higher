import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  extensionFormSchema,
  formToExtensionSchema,
  type ExtensionFormValues,
} from "@/lib/extensions/schemas";
import type { StacExtension } from "@/lib/extensions/types";
import { extensionToForm } from "@/lib/extensions/schemas";
import {
  useCreateExtension,
  useUpdateExtension,
} from "@/lib/extensions/queries";
import { QueryProvider } from "@/components/layout/QueryProvider";
import { Header } from "@/components/layout/Header";
import { JsonViewer } from "@stac-higher/shared";
import { Button } from "@stac-higher/shared";
import { Input } from "@stac-higher/shared";
import { Textarea } from "@stac-higher/shared";
import { Label } from "@stac-higher/shared";
import { Badge } from "@stac-higher/shared";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@stac-higher/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@stac-higher/shared";
import { Switch } from "@stac-higher/shared";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

const PROPERTY_TYPES = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "boolean", label: "Boolean" },
  { value: "array", label: "Array" },
] as const;

const ARRAY_ITEM_TYPES = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "boolean", label: "Boolean" },
] as const;

const NONE_VALUE = "__none__";

const STRING_FORMATS = [
  "date-time",
  "date",
  "time",
  "uri",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
];

interface ExtensionFormInnerProps {
  existingExtension?: StacExtension;
}

function ExtensionFormInner({ existingExtension }: ExtensionFormInnerProps) {
  const isEdit = !!existingExtension;
  const createMutation = useCreateExtension();
  const updateMutation = useUpdateExtension();

  const form = useForm<ExtensionFormValues>({
    resolver: zodResolver(extensionFormSchema) as any,
    defaultValues: existingExtension
      ? extensionToForm(existingExtension)
      : {
          name: "",
          prefix: "",
          version: "1.0.0",
          description: "",
          properties: [
            {
              name: "",
              type: "string",
              description: "",
              required: false,
            },
          ],
        },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "properties",
  });

  const watchAll = watch();
  const previewSchema = formToExtensionSchema(watchAll);

  const onSubmit = (data: ExtensionFormValues) => {
    if (isEdit && existingExtension) {
      updateMutation.mutate(
        { id: existingExtension.id, data },
        {
          onSuccess: () => {
            toast.success("Extension updated");
            window.location.href = `/extensions/${encodeURIComponent(existingExtension.id)}`;
          },
          onError: (err) => toast.error(`Update failed: ${err.message}`),
        },
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: (ext) => {
          toast.success("Extension created");
          window.location.href = `/extensions/${encodeURIComponent(ext.id)}`;
        },
        onError: (err) => toast.error(`Create failed: ${err.message}`),
      });
    }
  };

  return (
    <>
      <Header />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <a
            href="/extensions"
            className="hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Extensions
          </a>
          <span>/</span>
          <span className="text-foreground">
            {isEdit ? `Edit ${existingExtension.name}` : "New Extension"}
          </span>
        </div>

        <h1 className="text-2xl font-bold mb-6">
          {isEdit ? "Edit Extension" : "Create Extension"}
        </h1>

        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Extension Name</Label>
                  <Input
                    id="name"
                    {...register("name")}
                    placeholder="My Extension"
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="prefix">Prefix</Label>
                    <Input
                      id="prefix"
                      {...register("prefix")}
                      placeholder="my_ext"
                      disabled={isEdit}
                    />
                    {errors.prefix && (
                      <p className="text-xs text-destructive">{errors.prefix.message}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Lowercase, alphanumeric + underscores
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="version">Version</Label>
                    <Input
                      id="version"
                      {...register("version")}
                      placeholder="1.0.0"
                    />
                    {errors.version && (
                      <p className="text-xs text-destructive">{errors.version.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    {...register("description")}
                    placeholder="Describe what this extension adds..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Properties */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Properties</CardTitle>
                  {errors.properties?.root && (
                    <p className="text-xs text-destructive mt-1">
                      {errors.properties.root.message}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      name: "",
                      type: "string",
                      description: "",
                      required: false,
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Property
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No properties added yet.
                  </p>
                )}
                {fields.map((field, index) => {
                  const propType = watchAll.properties?.[index]?.type ?? "string";
                  const prefix = watchAll.prefix || "prefix";
                  const propName = watchAll.properties?.[index]?.name || "property";
                  const isRequired = watchAll.properties?.[index]?.required ?? false;

                  return (
                    <div
                      key={field.id}
                      className="space-y-3 p-4 rounded-lg border border-border"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {prefix}:{propName}
                          </Badge>
                          {isRequired && (
                            <Badge variant="destructive" className="text-xs">
                              required
                            </Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => remove(index)}
                          aria-label="Remove property"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Property Name</Label>
                          <Input
                            {...register(`properties.${index}.name`)}
                            placeholder="cloud_cover"
                          />
                          {errors.properties?.[index]?.name && (
                            <p className="text-xs text-destructive">
                              {errors.properties[index]?.name?.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={propType}
                            onValueChange={(v) =>
                              setValue(
                                `properties.${index}.type`,
                                v as ExtensionFormValues["properties"][number]["type"],
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROPERTY_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input
                          {...register(`properties.${index}.description`)}
                          placeholder="Describe this property..."
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Switch
                          id={`required-${index}`}
                          checked={isRequired}
                          onCheckedChange={(v) =>
                            setValue(`properties.${index}.required`, v)
                          }
                        />
                        <Label htmlFor={`required-${index}`} className="text-xs cursor-pointer">
                          Required
                        </Label>
                      </div>

                      {/* Conditional fields per type */}
                      {(propType === "string" ||
                        propType === "number" ||
                        propType === "integer") && (
                        <div className="space-y-3 pt-1 border-t border-border/50">
                          <p className="text-xs text-muted-foreground font-medium">
                            Constraints
                          </p>

                          {propType === "string" && (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Format</Label>
                                <Select
                                  value={watchAll.properties?.[index]?.format || NONE_VALUE}
                                  onValueChange={(v) =>
                                    setValue(
                                      `properties.${index}.format`,
                                      v === NONE_VALUE ? undefined : v,
                                    )
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                                    {STRING_FORMATS.map((f) => (
                                      <SelectItem key={f} value={f}>
                                        {f}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Default Value</Label>
                                <Input
                                  {...register(`properties.${index}.default`)}
                                  placeholder='"value"'
                                />
                              </div>
                            </div>
                          )}

                          {(propType === "number" || propType === "integer") && (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Minimum</Label>
                                <Input
                                  {...register(`properties.${index}.minimum`)}
                                  placeholder="0"
                                  type="number"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Maximum</Label>
                                <Input
                                  {...register(`properties.${index}.maximum`)}
                                  placeholder="100"
                                  type="number"
                                />
                              </div>
                            </div>
                          )}

                          <div className="space-y-1">
                            <Label className="text-xs">Enum Values</Label>
                            <Input
                              {...register(`properties.${index}.enumValues`)}
                              placeholder="value1, value2, value3"
                            />
                            <p className="text-xs text-muted-foreground">
                              Comma-separated list of allowed values
                            </p>
                          </div>
                        </div>
                      )}

                      {propType === "array" && (
                        <div className="space-y-3 pt-1 border-t border-border/50">
                          <p className="text-xs text-muted-foreground font-medium">
                            Array Configuration
                          </p>
                          <div className="space-y-1">
                            <Label className="text-xs">Item Type</Label>
                            <Select
                              value={
                                watchAll.properties?.[index]?.arrayItemType ?? "string"
                              }
                              onValueChange={(v) =>
                                setValue(
                                  `properties.${index}.arrayItemType`,
                                  v as ExtensionFormValues["properties"][number]["arrayItemType"],
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ARRAY_ITEM_TYPES.map((t) => (
                                  <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {propType === "boolean" && (
                        <div className="space-y-1 pt-1 border-t border-border/50">
                          <Label className="text-xs">Default Value</Label>
                          <Select
                            value={watchAll.properties?.[index]?.default || NONE_VALUE}
                            onValueChange={(v) =>
                              setValue(
                                `properties.${index}.default`,
                                v === NONE_VALUE ? undefined : v,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_VALUE}>None</SelectItem>
                              <SelectItem value="true">true</SelectItem>
                              <SelectItem value="false">false</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}

                {fields.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      append({
                        name: "",
                        type: "string",
                        description: "",
                        required: false,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add First Property
                  </Button>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                <Save className="h-4 w-4 mr-1.5" />
                {isSubmitting
                  ? "Saving..."
                  : isEdit
                    ? "Update Extension"
                    : "Create Extension"}
              </Button>
              <a href="/extensions">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </a>
            </div>
          </form>

          <div className="hidden lg:block">
            <div className="sticky top-20">
              <JsonViewer data={previewSchema} title="JSON Schema Preview" defaultOpen />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export function ExtensionFormPage({
  existingExtension,
}: {
  existingExtension?: StacExtension;
}) {
  return (
    <QueryProvider>
      <ExtensionFormInner existingExtension={existingExtension} />
    </QueryProvider>
  );
}
