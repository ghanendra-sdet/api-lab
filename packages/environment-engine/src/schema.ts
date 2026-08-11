import { z } from "zod";

const variableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  secret: z.boolean(),
});

const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  variables: z.array(variableSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const environmentWorkspaceSchema = z.object({
  environments: z.array(environmentSchema),
  activeEnvironmentId: z.string().nullable(),
});
