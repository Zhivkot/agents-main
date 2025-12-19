import { defineFunction } from '@aws-amplify/backend';

export const invokeAgent = defineFunction({
  name: 'invokeAgent',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 256,
});
