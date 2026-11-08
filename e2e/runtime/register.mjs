import { registerHooks } from 'node:module';

// The production bundle keeps openid-client external. Only this mounted E2E
// preload selects the wrapper; production images contain neither file.
const wrapper = new URL('./openid-client.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'openid-client' && context.parentURL !== wrapper) {
      return { url: wrapper, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
