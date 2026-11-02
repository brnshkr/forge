import { getConfig } from '@brnshkr/config/vitest';

export default getConfig({
  test: {
    isolate: false,
    coverage: {
      include: [
        'src/**/*.ts',
      ],
    },
  },
});
