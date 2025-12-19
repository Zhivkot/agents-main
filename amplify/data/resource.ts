import { defineData, a, type ClientSchema } from '@aws-amplify/backend';
import { invokeAgent } from '../functions/invokeAgent/resource';

const schema = a.schema({
  AgentResponse: a.customType({
    success: a.boolean().required(),
    response: a.string(),
    error: a.string(),
    sessionId: a.string().required(),
  }),

  invokeAgent: a
    .query()
    .arguments({
      message: a.string().required(),
      sessionId: a.string().required(),
    })
    .returns(a.ref('AgentResponse'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(invokeAgent)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
