import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { extensionKeys } from "@/lib/query/keys";
import {
  fetchExtensions,
  fetchExtension,
  createExtension,
  updateExtension,
  deleteExtension,
  importExtension,
} from "./api";
import type { ExtensionFormData } from "./types";

export function useExtensions() {
  return useQuery({
    queryKey: extensionKeys.list(),
    queryFn: fetchExtensions,
  });
}

export function useExtension(id: string) {
  return useQuery({
    queryKey: extensionKeys.detail(id),
    queryFn: () => fetchExtension(id),
    enabled: !!id,
  });
}

export function useCreateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ExtensionFormData) => createExtension(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.list() });
    },
  });
}

export function useUpdateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExtensionFormData }) =>
      updateExtension(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: extensionKeys.list() });
      qc.invalidateQueries({ queryKey: extensionKeys.detail(id) });
    },
  });
}

export function useDeleteExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteExtension(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.list() });
    },
  });
}

export function useImportExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => importExtension(url),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.list() });
    },
  });
}
